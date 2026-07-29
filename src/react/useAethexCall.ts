// NOTE: the "use client" directive is injected into the published bundle by the
// tsup banner (see tsup.config.ts), not kept here — esbuild would otherwise warn
// and strip module-level directives during bundling.
import { useCallback, useEffect, useRef, useState } from "react"
import { VoiceCall } from "../core/VoiceCall.js"
import { AethexError } from "../core/errors.js"
import type { Logger } from "../core/logger.js"
import type { AethexCallConfig, CallStatus, PipelineMetrics, SessionStatusResponse } from "../core/types.js"

export interface UseAethexCallOptions extends AethexCallConfig {
  /** Called when the call reaches the `connected` status. */
  onConnected?: () => void
  /** Called when an established call ends (remote hang-up or stop()). */
  onEnded?: () => void
  /** Called on a terminal error (also reflected in `error`). */
  onError?: (error: AethexError) => void
  /** Called for each `pipeline-metrics` message (also reflected in `metrics`). */
  onMetrics?: (metrics: PipelineMetrics) => void
  /** Injectable logger (no-op by default). */
  logger?: Logger
}

export interface UseAethexCallResult {
  status: CallStatus
  isConnecting: boolean
  isConnected: boolean
  /** True while the agent is actively speaking (derived from its output level). Web only; always false on React Native. */
  isSpeaking: boolean
  /** Whether the local microphone is muted. */
  isMuted: boolean
  /** Agent output volume in 0..1. */
  volume: number
  /** Remote audio stream (already auto-played); pass to `useAudioLevel` for a visualizer. */
  remoteStream: MediaStream | null
  /** Latest `pipeline-metrics` payload, or null. */
  metrics: PipelineMetrics | null
  /** Terminal error, or null. Use `error.code` / `error.recoverable` to branch. */
  error: AethexError | null
  sessionId: string | null
  /** Start (or restart) the call. Never throws — observe `status` / `error`. */
  start: () => Promise<void>
  /** Idempotent teardown. */
  stop: () => void
  /** Send an interruption signal to the agent. */
  interrupt: () => void
  /** Mute or unmute the local microphone. */
  setMuted: (muted: boolean) => void
  /** Flip the mic mute and return the new muted state. */
  toggleMute: () => boolean
  /** Set the agent output volume (clamped to 0..1). No-op on React Native (device-level routing). */
  setOutputVolume: (volume: number) => void
  /** Fetch the server-side session status (duration, turn count, …). Works after the call ends; rejects with no active call. */
  getRemoteStatus: (signal?: AbortSignal) => Promise<SessionStatusResponse>
  /** Submit end-of-call feedback (rating 1..5 + optional comment). Works after the call ends; rejects with no active call. */
  submitFeedback: (rating: number, comment?: string, signal?: AbortSignal) => Promise<void>
}

/**
 * Headless React hook around {@link VoiceCall}. SSR-safe (no browser access at
 * import or render — only inside `start`, which runs on a user gesture) and
 * StrictMode-safe (the unmount teardown is idempotent).
 */
export function useAethexCall(options: UseAethexCallOptions): UseAethexCallResult {
  const [status, setStatus] = useState<CallStatus>("idle")
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null)
  const [error, setError] = useState<AethexError | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)

  const callRef = useRef<VoiceCall | null>(null)
  // Output volume persists across calls; re-applied to each new VoiceCall.
  const volumeRef = useRef(1)
  // Latest options without re-creating start/stop on every render.
  const optionsRef = useRef(options)
  optionsRef.current = options

  const stop = useCallback(() => {
    callRef.current?.stop()
  }, [])

  const start = useCallback(async () => {
    // VoiceCall is single-use. Build the new instance first, make it current,
    // then tear down the previous one — so the previous instance's late
    // callbacks (e.g. its "ended" status from stop()) are ignored by the
    // `callRef.current !== call` guard and never fire a spurious onEnded.
    const previous = callRef.current
    const o = optionsRef.current
    // Each callback no-ops unless this instance is still the current one. This
    // also prevents setState after unmount (cleanup nulls callRef first).
    const isCurrent = () => callRef.current === call
    const call: VoiceCall = new VoiceCall({
      agentId: o.agentId,
      ...(o.apiBaseUrl ? { apiBaseUrl: o.apiBaseUrl } : {}),
      ...(o.getToken ? { getToken: o.getToken } : {}),
      ...(o.endpoints ? { endpoints: o.endpoints } : {}),
      ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      ...(o.audioConstraints ? { audioConstraints: o.audioConstraints } : {}),
      ...(o.platform ? { platform: o.platform } : {}),
      ...(o.iceRestart !== undefined ? { iceRestart: o.iceRestart } : {}),
      ...(o.maxIceRestarts !== undefined ? { maxIceRestarts: o.maxIceRestarts } : {}),
      ...(o.logger ? { logger: o.logger } : {}),
      callbacks: {
        onStatusChange: (s) => {
          if (!isCurrent()) return
          setStatus(s)
          if (s === "connected") {
            setSessionId(call.getSessionId())
            optionsRef.current.onConnected?.()
          } else if (s === "ended") {
            optionsRef.current.onEnded?.()
          }
        },
        onRemoteStream: (st) => {
          if (isCurrent()) setRemoteStream(st)
        },
        onMetrics: (m) => {
          if (!isCurrent()) return
          setMetrics(m)
          optionsRef.current.onMetrics?.(m)
        },
        onError: (e) => {
          if (!isCurrent()) return
          setError(e)
          optionsRef.current.onError?.(e)
        },
      },
    })
    callRef.current = call
    // Carry the output-volume preference into the fresh call; mute is per-call.
    call.setOutputVolume(volumeRef.current)
    setError(null)
    setMetrics(null)
    setRemoteStream(null)
    setSessionId(null)
    setIsSpeaking(false)
    setIsMuted(false)
    previous?.stop()
    try {
      await call.start()
    } catch {
      // Already surfaced via onError + `error` state; never throw to the caller.
    }
  }, [])

  const interrupt = useCallback(() => {
    callRef.current?.interrupt()
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    callRef.current?.setMuted(muted)
    setIsMuted(muted)
  }, [])

  const toggleMute = useCallback((): boolean => {
    const next = !(callRef.current?.isMuted ?? false)
    callRef.current?.setMuted(next)
    setIsMuted(next)
    return next
  }, [])

  const setOutputVolume = useCallback((v: number) => {
    const clamped = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
    volumeRef.current = clamped
    callRef.current?.setOutputVolume(clamped)
    setVolume(clamped)
  }, [])

  // Poll the agent's output level while connected to derive `isSpeaking`. A
  // short hangover keeps the flag from flickering between words. On React Native
  // the level reads 0 (no analyser), so this stays false — as documented.
  useEffect(() => {
    if (status !== "connected") {
      setIsSpeaking(false)
      return
    }
    const nowMs = (): number =>
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()
    const THRESHOLD = 0.02
    const HANGOVER_MS = 250
    let raf = 0
    let speaking = false
    let lastAbove = 0
    const tick = (): void => {
      const level = callRef.current?.getOutputLevel() ?? 0
      const now = nowMs()
      if (level > THRESHOLD) {
        lastAbove = now
        if (!speaking) {
          speaking = true
          setIsSpeaking(true)
        }
      } else if (speaking && now - lastAbove > HANGOVER_MS) {
        speaking = false
        setIsSpeaking(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setIsSpeaking(false)
    }
  }, [status])

  const getRemoteStatus = useCallback(async (signal?: AbortSignal): Promise<SessionStatusResponse> => {
    const call = callRef.current
    if (!call) throw new AethexError("connect_failed", "No active call to query status for.")
    return call.getRemoteStatus(signal)
  }, [])

  const submitFeedback = useCallback(
    async (rating: number, comment?: string, signal?: AbortSignal): Promise<void> => {
      const call = callRef.current
      if (!call) throw new AethexError("connect_failed", "No active call to submit feedback for.")
      return call.submitFeedback(rating, comment, signal)
    },
    [],
  )

  // Tear down on unmount. Null the ref BEFORE stop() so the instance's
  // callbacks (guarded by callRef.current === call) can't setState after
  // unmount. Idempotent → safe under StrictMode's mount→cleanup→remount.
  useEffect(() => {
    return () => {
      const call = callRef.current
      callRef.current = null
      call?.stop()
    }
  }, [])

  return {
    status,
    isConnecting: status === "connecting",
    isConnected: status === "connected",
    isSpeaking,
    isMuted,
    volume,
    remoteStream,
    metrics,
    error,
    sessionId,
    start,
    stop,
    interrupt,
    setMuted,
    toggleMute,
    setOutputVolume,
    getRemoteStatus,
    submitFeedback,
  }
}
