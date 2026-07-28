import type { CSSProperties } from "react"
import { useAethexCall, type UseAethexCallOptions } from "../react/useAethexCall.js"
import { DEFAULT_LABELS, srOnly, type StatusLabels } from "./styles.js"

export interface AethexCallButtonProps extends UseAethexCallOptions {
  /** Override the per-status button labels. */
  labels?: Partial<StatusLabels>
  className?: string
  style?: CSSProperties
}

/**
 * Accessible call/hang-up button. A native `<button>` (full keyboard support).
 * State is conveyed by the visible label (not `aria-pressed`, which would
 * conflict with a changing label); `aria-busy` marks the connecting phase.
 * The button stays enabled while connecting so it can cancel and never drops
 * keyboard focus. An `aria-live` region announces state changes.
 */
export function AethexCallButton(props: AethexCallButtonProps) {
  const { labels, className, style, ...callOptions } = props
  const { status, isConnecting, isConnected, start, stop, error } = useAethexCall(callOptions)
  const resolvedLabels: StatusLabels = { ...DEFAULT_LABELS, ...labels }

  // Clicking while connecting cancels; while connected hangs up; otherwise starts.
  const active = isConnected || isConnecting
  const label =
    status === "connected"
      ? resolvedLabels.connected
      : status === "connecting"
        ? resolvedLabels.connecting
        : status === "error"
          ? resolvedLabels.error
          : resolvedLabels.idle

  const announce =
    status === "connected"
      ? "In call"
      : status === "connecting"
        ? "Connecting"
        : status === "error"
          ? `Call failed: ${error?.code ?? "unknown"}`
          : "Idle"

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        data-status={status}
        aria-busy={isConnecting || undefined}
        onClick={active ? stop : start}
      >
        {label}
      </button>
      <span role="status" style={srOnly}>
        {announce}
      </span>
    </>
  )
}
