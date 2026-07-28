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
  /** Fetch the server-side session status (duration, turn count, …). Works after the call ends; rejects with no active call. */
  getRemoteStatus: (signal?: AbortSignal) => Promise<SessionStatusResponse>
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

  const callRef = useRef<VoiceCall | null>(null)
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
      apiBaseUrl: o.apiBaseUrl,
      ...(o.endpoints ? { endpoints: o.endpoints } : {}),
      ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      ...(o.audioConstraints ? { audioConstraints: o.audioConstraints } : {}),
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
    setError(null)
    setMetrics(null)
    setRemoteStream(null)
    setSessionId(null)
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

  const getRemoteStatus = useCallback(async (signal?: AbortSignal): Promise<SessionStatusResponse> => {
    const call = callRef.current
    if (!call) throw new AethexError("connect_failed", "No active call to query status for.")
    return call.getRemoteStatus(signal)
  }, [])

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
    remoteStream,
    metrics,
    error,
    sessionId,
    start,
    stop,
    interrupt,
    getRemoteStatus,
  }
}
