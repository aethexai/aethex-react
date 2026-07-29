import { AethexError, abortReason } from "./errors.js"
import { noopLogger, type Logger } from "./logger.js"
import { webPlatform, type RemoteAudioHandle, type WebRTCPlatform } from "./platform.js"
import { Transport } from "./transport.js"
import type { AethexCallConfig, CallStatus, PipelineMetrics, SessionStatusResponse } from "./types.js"

/** Lifecycle + data callbacks. All optional; all framework-agnostic. */
export interface VoiceCallCallbacks {
  /** High-level status transitions: idle → connecting → connected → ended | error. */
  onStatusChange?: (status: CallStatus) => void
  /** Raw RTCPeerConnection state, for consumers that want the detail. */
  onPeerStateChange?: (state: RTCPeerConnectionState) => void
  /** Remote audio MediaStream — already attached to a managed <audio> element. */
  onRemoteStream?: (stream: MediaStream) => void
  /** `pipeline-metrics` messages from the `chat` data channel. */
  onMetrics?: (metrics: PipelineMetrics) => void
  /** Fired at most once on a terminal error. */
  onError?: (error: AethexError) => void
  /** Fired at most once when an established call ends remotely/gracefully. */
  onClose?: () => void
}

export interface VoiceCallOptions extends AethexCallConfig {
  callbacks?: VoiceCallCallbacks
  logger?: Logger
}

const DEFAULT_AUDIO: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
}

const DISCONNECT_GRACE_MS = 6_000
const ICE_FLUSH_DEBOUNCE_MS = 50
// Backoff before retrying a failed ICE flush (candidates are requeued, not lost).
const ICE_RETRY_DELAY_MS = 600

/**
 * Framework-agnostic WebRTC voice call against an Aethex proxy.
 *
 * Pure TS — no React. The ordering of operations in `start()` is load-bearing
 * for the WebRTC handshake: the audio track is added before the data channel,
 * and the `chat` data channel is created client-side. See inline STEP comments.
 */
export class VoiceCall {
  private readonly agentId: string
  private readonly transport: Transport
  private readonly audioConstraints: MediaTrackConstraints
  private readonly cb: VoiceCallCallbacks
  private readonly log: Logger
  private readonly iceRestartEnabled: boolean
  private readonly maxIceRestarts: number
  private readonly platform: WebRTCPlatform

  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private localStream: MediaStream | null = null
  private remoteAudio: RemoteAudioHandle | null = null
  private sessionId: string | null = null
  private pcId: string | null = null

  /** Mic-mute + agent-volume state, applied to tracks / the sink when present. */
  private muted = false
  private volumeLevel = 1

  private iceQueue: RTCIceCandidate[] = []
  private flushScheduled = false
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null
  private iceRestartAttempts = 0
  private restarting = false
  private readonly abort = new AbortController()

  /** Guards re-entrant callbacks and ensures resources are released once. */
  private closed = false
  private released = false
  /** Distinguishes "call never came up" (worth retrying) from "dropped". */
  everConnected = false
  private status: CallStatus = "idle"

  constructor(options: VoiceCallOptions) {
    if (!options.agentId) throw new AethexError("connect_failed", "agentId is required.")
    if (!options.apiBaseUrl && !options.getToken) {
      throw new AethexError(
        "connect_failed",
        "Provide apiBaseUrl (a proxy) or getToken (an ephemeral call token).",
      )
    }
    if (options.apiBaseUrl && /ae_live_/.test(options.apiBaseUrl)) {
      // Loud guard against a common misuse: pointing at the direct API / a key.
      throw new AethexError(
        "connect_failed",
        "apiBaseUrl must point to a proxy, not an API key / the direct API.",
      )
    }
    this.agentId = options.agentId
    this.transport = new Transport(options)
    this.audioConstraints = options.audioConstraints ?? DEFAULT_AUDIO
    this.cb = options.callbacks ?? {}
    this.log = options.logger ?? noopLogger
    this.iceRestartEnabled = options.iceRestart ?? true
    this.maxIceRestarts = Math.max(0, options.maxIceRestarts ?? 1)
    this.platform = options.platform ?? webPlatform
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  getStatus(): CallStatus {
    return this.status
  }

  /**
   * Establish the call. Resolves once the answer is applied; the `connected`
   * status arrives later via the peer connection state change.
   */
  async start(): Promise<void> {
    if (this.status !== "idle") {
      throw new AethexError("connect_failed", `Cannot start in status "${this.status}".`)
    }
    this.assertSupported()
    this.setStatus("connecting")

    try {
      // 0) Mint/fetch the ephemeral call token (if configured) before signaling.
      await this.transport.ensureAuth()
      this.throwIfClosed()

      // 1) Create the session and learn the ICE servers.
      const conn = await this.transport.connect(this.agentId, this.abort.signal)
      this.throwIfClosed()
      this.sessionId = conn.session_id
      const pc = this.platform.createPeerConnection(conn.ice_config)
      this.pc = pc

      // Pre-check mic permission — some browsers resolve getUserMedia on a prior
      // denial without prompting, yielding a zero-track stream.
      await this.precheckMic()
      this.throwIfClosed()

      // STEP A: acquire mic and addTrack FIRST so the audio m-section precedes
      // the data channel in the offer. Adding them in the other order fails to
      // establish the connection.
      this.localStream = await this.platform.getUserMedia({ audio: this.audioConstraints })
      if (this.localStream.getAudioTracks().length === 0) {
        this.localStream.getTracks().forEach((t) => t.stop())
        this.localStream = null
        throw new AethexError("mic_missing", "Microphone returned no audio tracks.")
      }
      this.throwIfClosed()
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream)
      }
      // Honour a mute toggled before the mic came up.
      this.applyMuted()

      pc.ontrack = (ev) => this.handleRemoteTrack(ev)

      // STEP B: data channel AFTER tracks. The "chat" channel is created
      // client-side.
      const dc = pc.createDataChannel("chat", { ordered: true })
      this.dc = dc
      dc.addEventListener("message", (ev) => this.handleDataMessage(ev as MessageEvent))
      dc.addEventListener("close", () => {
        if (this.everConnected && !this.closed) this.endGracefully()
      })

      pc.onconnectionstatechange = () => this.handleConnectionStateChange()
      pc.onicecandidate = (ev) => {
        if (this.closed || !ev.candidate) return
        this.iceQueue.push(ev.candidate)
        this.scheduleIceFlush()
      }

      // STEP C: offer with NO legacy offerToReceive* options — addTrack drives
      // the SDP shape; extra recvonly transceivers change it and break the handshake.
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.throwIfClosed()

      const answer = await this.transport.sendOffer(
        this.sessionId,
        { sdp: offer.sdp, type: offer.type },
        this.abort.signal,
      )
      this.pcId = answer.pc_id

      // STEP D: flush gathered candidates (now with pc_id) BEFORE
      // setRemoteDescription, so the server can start checks immediately.
      await this.flushIce().catch(() => {})
      this.throwIfClosed()

      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp })
    } catch (err) {
      const aethexErr =
        err instanceof AethexError
          ? err
          : new AethexError("unknown", "Unexpected error while connecting.", { cause: err })
      this.fail(aethexErr)
      throw aethexErr
    }
  }

  /** Send an interruption signal over the data channel (best-effort). */
  interrupt(): void {
    this.send({ type: "inject_interrupt" })
  }

  /** Mute or unmute the local microphone (disables/enables the audio track). */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMuted()
  }

  /** Flip the mic mute and return the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  /** Whether the local microphone is currently muted. */
  get isMuted(): boolean {
    return this.muted
  }

  /**
   * Set the agent's output volume in 0..1. Web applies it to the audio sink;
   * React Native routes at the device level, so this is a no-op there. Stored
   * and re-applied when the remote audio attaches, so it is safe to call early.
   */
  setOutputVolume(volume: number): void {
    this.volumeLevel = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : this.volumeLevel
    this.remoteAudio?.setVolume?.(this.volumeLevel)
  }

  /** Current agent output volume in 0..1 (defaults to 1). */
  get outputVolume(): number {
    return this.volumeLevel
  }

  /**
   * Instantaneous agent output level in ~0..1 (RMS), for driving an
   * `isSpeaking` indicator or a visualizer. Returns 0 when the platform can't
   * measure it (e.g. React Native) or before audio attaches.
   */
  getOutputLevel(): number {
    return this.remoteAudio?.getLevel?.() ?? 0
  }

  private applyMuted(): void {
    const stream = this.localStream
    if (!stream) return
    for (const track of stream.getAudioTracks()) track.enabled = !this.muted
  }

  /** Send an arbitrary control message over the `chat` data channel. */
  send(message: unknown): void {
    if (this.dc?.readyState === "open") {
      try {
        this.dc.send(JSON.stringify(message))
      } catch (err) {
        this.log.warn("data channel send failed", { err: String(err) })
      }
    }
  }

  /**
   * Fetch the server-side session status (duration, turn count, …). Distinct
   * from `getStatus()`, which returns the local WebRTC lifecycle state. Works
   * for a completed session too — so it is NOT tied to the call's own abort
   * signal (which fires on `stop()`); pass your own `signal` to cancel. Rejects
   * only if the call never opened a session.
   */
  async getRemoteStatus(signal?: AbortSignal): Promise<SessionStatusResponse> {
    if (!this.sessionId) {
      throw new AethexError("connect_failed", "No active session to query status for.")
    }
    return this.transport.getStatus(this.sessionId, signal ?? new AbortController().signal)
  }

  /**
   * Submit end-of-call feedback for this session — a 1..5 `rating` (clamped) and
   * an optional free-text `comment`, authorized by the call token. Like
   * {@link getRemoteStatus}, it works after the call ends and is NOT tied to the
   * call's abort signal; pass your own `signal` to cancel. Rejects if the call
   * never opened a session.
   */
  async submitFeedback(rating: number, comment?: string, signal?: AbortSignal): Promise<void> {
    if (!this.sessionId) {
      throw new AethexError("connect_failed", "No session to submit feedback for.")
    }
    await this.transport.submitFeedback(
      this.sessionId,
      comment !== undefined ? { rating, comment } : { rating },
      signal ?? new AbortController().signal,
    )
  }

  /** Idempotent user-initiated teardown. Safe to call multiple times. */
  stop(): void {
    if (this.closed) return
    this.closed = true
    this.release()
    if (this.status !== "error") this.setStatus("ended")
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Remote hang-up / graceful close of an established call. Fires onClose once. */
  private endGracefully(): void {
    if (this.closed) return
    this.closed = true
    this.release()
    this.cb.onClose?.()
    if (this.status !== "error") this.setStatus("ended")
  }

  /** Terminal failure. Releases resources and fires onError at most once. */
  private fail(error: AethexError): void {
    const firstError = this.status !== "error"
    if (!this.closed) {
      this.closed = true
      this.release()
    }
    if (firstError) {
      this.setStatus("error")
      this.cb.onError?.(error)
    }
  }

  /**
   * Release every resource exactly once. No callbacks, no status changes — the
   * caller (stop/endGracefully/fail) owns those. `closed` must already be true
   * so the data-channel close listener does not re-enter onClose.
   */
  private release(): void {
    if (this.released) return
    this.released = true

    this.abort.abort(abortReason("AbortError", "call stopped"))
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer)
      this.disconnectTimer = null
    }
    // Detach handlers BEFORE close() — close() may fire a final
    // connectionstatechange synchronously and re-enter our callbacks.
    if (this.pc) {
      this.pc.onconnectionstatechange = null
      this.pc.ontrack = null
      this.pc.onicecandidate = null
    }
    try {
      this.localStream?.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    try {
      this.dc?.close()
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close()
    } catch {
      /* ignore */
    }
    if (this.remoteAudio) {
      try {
        this.remoteAudio.detach()
      } catch {
        /* ignore */
      }
      this.remoteAudio = null
    }
    if (this.sessionId) void this.transport.end(this.sessionId)

    this.dc = null
    this.pc = null
    this.localStream = null
  }

  private assertSupported(): void {
    if (!this.platform.isSupported()) {
      throw new AethexError("unsupported_browser", "This host does not support WebRTC microphone calls.")
    }
  }

  private async precheckMic(): Promise<void> {
    // A definitive "denied" lets us fail fast with the right code before the
    // getUserMedia prompt. "unknown" (React Native, older browsers) falls
    // through to getUserMedia, which prompts and maps its own errors.
    if ((await this.platform.queryMicrophonePermission()) === "denied") {
      throw new AethexError("mic_denied", "Microphone is blocked by device or browser policy.")
    }
  }

  private handleRemoteTrack(ev: RTCTrackEvent): void {
    const [stream] = ev.streams
    if (!stream) return
    // Attach the audio sink once — a voice call has a single remote audio stream.
    if (!this.remoteAudio) {
      this.remoteAudio = this.platform.attachRemoteAudio(stream)
      this.remoteAudio.setVolume?.(this.volumeLevel)
    }
    this.cb.onRemoteStream?.(stream)
  }

  private handleDataMessage(ev: MessageEvent): void {
    if (typeof ev.data !== "string") return
    let msg: unknown
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if ((msg as { type?: string })?.type === "pipeline-metrics") {
      this.cb.onMetrics?.(msg as PipelineMetrics)
    }
  }

  private handleConnectionStateChange(): void {
    if (!this.pc) return
    const s = this.pc.connectionState
    this.cb.onPeerStateChange?.(s)

    if (s === "connected") {
      this.everConnected = true
      // A clean recovery resets the budget so `maxIceRestarts` counts
      // *consecutive* failures, not the call's lifetime total.
      this.iceRestartAttempts = 0
      this.setStatus("connected")
    }
    if (this.disconnectTimer && s !== "disconnected") {
      clearTimeout(this.disconnectTimer)
      this.disconnectTimer = null
    }

    if (s === "failed") {
      // A `failed` connection is genuinely broken — this is the textbook ICE
      // restart trigger. `disconnected` (below) is transient and self-heals, so
      // it keeps its original grace-then-end behaviour and never restarts.
      if (this.canIceRestart()) void this.attemptIceRestart()
      else this.fail(new AethexError("peer_failed", "Peer connection failed.", { recoverable: true }))
    } else if (s === "closed") {
      if (this.everConnected) this.endGracefully()
      else this.fail(new AethexError("peer_failed", "Peer connection closed.", { recoverable: true }))
    } else if (s === "disconnected") {
      // Guard against a repeated `disconnected` orphaning an in-flight timer.
      if (this.disconnectTimer) return
      this.disconnectTimer = setTimeout(() => {
        this.disconnectTimer = null
        if (this.pc?.connectionState !== "disconnected") return
        if (this.everConnected) this.endGracefully()
        else
          this.fail(
            new AethexError("peer_failed", "Peer disconnected before connecting.", { recoverable: true }),
          )
      }, DISCONNECT_GRACE_MS)
    }
  }

  /**
   * Eligible to renegotiate an ICE restart: enabled, on a call that DID come up
   * (so we hold a `pc_id`), not already restarting or torn down, and with
   * attempts to spare. A restart that itself fails calls `fail()`.
   */
  private canIceRestart(): boolean {
    return (
      this.iceRestartEnabled &&
      this.everConnected &&
      !this.restarting &&
      !this.closed &&
      !!this.pc &&
      !!this.sessionId &&
      this.iceRestartAttempts < this.maxIceRestarts
    )
  }

  private async attemptIceRestart(): Promise<void> {
    if (this.restarting || this.closed || !this.pc || !this.sessionId) return
    this.restarting = true
    this.iceRestartAttempts++
    this.log.debug("attempting ICE restart", { attempt: this.iceRestartAttempts })
    try {
      const offer = await this.pc.createOffer({ iceRestart: true })
      await this.pc.setLocalDescription(offer)
      this.throwIfClosed()
      const answer = await this.transport.sendOffer(
        this.sessionId,
        { sdp: offer.sdp, type: offer.type },
        this.abort.signal,
        { pcId: this.pcId, restartPc: true },
      )
      this.pcId = answer.pc_id
      await this.flushIce().catch(() => {})
      this.throwIfClosed()
      await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp })
    } catch (err) {
      if (!this.closed) {
        this.fail(
          err instanceof AethexError
            ? err
            : new AethexError("peer_failed", "ICE restart failed.", { recoverable: true, cause: err }),
        )
      }
    } finally {
      this.restarting = false
    }
  }

  // Trickle ICE eagerly: do NOT gate on pcId. While pcId is still null we PATCH
  // with `pc_id: null` and rely on the proxy to buffer those early candidates,
  // forwarding them once pcId is known (from the offer answer). Sending
  // candidates as early as possible matters for slow gatherers — e.g. browsers
  // behind a symmetric NAT that can only use a TURN relay — which otherwise fail
  // to connect in time. The `/ice` endpoint requires `pc_id`, so this needs a
  // proxy that buffers `pc_id: null` candidates until pcId is known (the bundled
  // example worker does); a proxy that forwards verbatim must add that buffer.
  private scheduleIceFlush(delayMs = ICE_FLUSH_DEBOUNCE_MS): void {
    if (this.flushScheduled || this.iceQueue.length === 0) return
    this.flushScheduled = true
    setTimeout(() => {
      this.flushScheduled = false
      this.flushIce().catch((e) => this.log.warn("ICE flush failed", { err: String(e) }))
    }, delayMs)
  }

  private async flushIce(): Promise<void> {
    if (this.closed || !this.sessionId) return
    const batch = this.iceQueue.splice(0, this.iceQueue.length)
    if (batch.length === 0) return
    try {
      await this.transport.sendIce(
        this.sessionId,
        this.pcId,
        batch.map((c) => ({
          candidate: c.candidate,
          sdp_mid: c.sdpMid ?? "",
          sdp_mline_index: c.sdpMLineIndex ?? 0,
        })),
        this.abort.signal,
      )
    } catch (err) {
      // A transient failure must not drop candidates: requeue (order preserved)
      // and retry with a small backoff — unless we're tearing down / aborted.
      if (!this.closed && !this.abort.signal.aborted) {
        this.iceQueue.unshift(...batch)
        this.log.warn("ICE flush failed; requeued for retry", { err: String(err) })
        this.scheduleIceFlush(ICE_RETRY_DELAY_MS)
      }
      return
    }
    if (this.iceQueue.length > 0) this.scheduleIceFlush()
  }

  private setStatus(status: CallStatus): void {
    if (this.status === status) return
    this.status = status
    this.cb.onStatusChange?.(status)
  }

  private throwIfClosed(): void {
    if (this.closed) {
      throw new AethexError("aborted", "The call was stopped during connection.")
    }
  }
}
