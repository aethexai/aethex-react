import { fromMediaError } from "./errors.js"

/** Clamp to the 0..1 range; non-finite input falls back to 0. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * A live remote-audio sink, returned by {@link WebRTCPlatform.attachRemoteAudio}.
 * The optional hooks are best-effort and platform-dependent — the core always
 * null-checks them, so an adapter may implement only `detach`.
 */
export interface RemoteAudioHandle {
  /** Tear the sink down (remove the element / release the session). */
  detach(): void
  /**
   * Set output volume in 0..1. Web sets the managed `<audio>` element's volume;
   * React Native routes at the device level, so it has no per-stream control.
   */
  setVolume?(volume: number): void
  /**
   * Instantaneous output level in ~0..1 (RMS), for deriving "is the agent
   * speaking". Web taps a WebAudio analyser; adapters that can't measure it omit
   * this (callers then treat the level as 0).
   */
  getLevel?(): number
}

/**
 * The handful of platform-specific touch-points a WebRTC mic call needs.
 *
 * Everything else in {@link VoiceCall} — signaling, ICE trickle, the lifecycle
 * state machine, ICE restart — is platform-agnostic. Only these four cross the
 * web/native line, so swapping this adapter is all it takes to run the exact
 * same call logic in a browser or in React Native.
 *
 * - **Web** ({@link webPlatform}, the default) wires them to the DOM +
 *   browser WebRTC.
 * - **React Native** wires them to `react-native-webrtc` (see the `./native`
 *   entry), whose `RTCPeerConnection` / `getUserMedia` / `MediaStream` mirror
 *   the browser API, so the call code is unchanged.
 */
export interface WebRTCPlatform {
  /** True when this host can run a WebRTC microphone call. */
  isSupported(): boolean
  /** Construct a peer connection from the server's ICE config. */
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection
  /**
   * Acquire the local microphone stream. Throws an `AethexError`
   * (`mic_denied` / `mic_missing`) on failure — callers do not re-map.
   */
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  /**
   * Report microphone permission WITHOUT prompting, for a pre-flight check.
   * Returns `"unknown"` when the host can't tell (then `getUserMedia` prompts).
   * Web uses the Permissions API; React Native returns `"unknown"`.
   */
  queryMicrophonePermission(): Promise<"granted" | "denied" | "prompt" | "unknown">
  /**
   * Make the remote audio audible and return a {@link RemoteAudioHandle}. Web
   * appends a hidden `<audio>` element (and taps a WebAudio analyser for the
   * output level); React Native relies on the native audio session (the track
   * plays once received) and routes it to the loudspeaker.
   */
  attachRemoteAudio(stream: MediaStream): RemoteAudioHandle
}

/** Browser platform: the DOM + Web WebRTC APIs. The SDK's default. */
export const webPlatform: WebRTCPlatform = {
  isSupported() {
    return (
      typeof RTCPeerConnection !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    )
  },

  createPeerConnection(config) {
    return new RTCPeerConnection(config)
  },

  async getUserMedia(constraints) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      throw fromMediaError(err)
    }
  },

  async queryMicrophonePermission() {
    try {
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
      if (perms?.query) {
        const status = await perms.query({ name: "microphone" as PermissionName })
        const state = status?.state
        if (state === "granted" || state === "denied" || state === "prompt") return state
      }
    } catch {
      // Permissions API unsupported / threw — fall through to getUserMedia.
    }
    return "unknown"
  },

  attachRemoteAudio(stream) {
    const el = document.createElement("audio")
    el.autoplay = true
    el.setAttribute("playsinline", "true")
    document.body.appendChild(el)
    el.srcObject = stream
    // Autoplay may be blocked until a user gesture; never let it crash the call.
    try {
      const p = el.play?.()
      if (p && typeof p.catch === "function") p.catch(() => {})
    } catch {
      /* ignore */
    }

    // Best-effort output meter for `isSpeaking`. If WebAudio is missing or the
    // browser blocks it, getLevel() just reports 0 and playback is unaffected.
    let audioCtx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let samples: Uint8Array | null = null
    try {
      const Ctx =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) {
        audioCtx = new Ctx()
        analyser = audioCtx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.6
        audioCtx.createMediaStreamSource(stream).connect(analyser)
        samples = new Uint8Array(analyser.fftSize)
      }
    } catch {
      audioCtx = null
      analyser = null
      samples = null
    }

    return {
      detach() {
        el.srcObject = null
        el.remove()
        try {
          void audioCtx?.close()
        } catch {
          /* ignore */
        }
      },
      setVolume(volume) {
        el.volume = clamp01(volume)
      },
      getLevel() {
        if (!analyser || !samples) return 0
        analyser.getByteTimeDomainData(samples)
        // RMS around the 128 zero-point → ~0..1.
        let sumSquares = 0
        for (let i = 0; i < samples.length; i++) {
          const v = ((samples[i] ?? 128) - 128) / 128
          sumSquares += v * v
        }
        return Math.sqrt(sumSquares / samples.length)
      },
    }
  },
}
