import type { CSSProperties } from "react"
import { useAethexCall, type UseAethexCallOptions } from "../react/useAethexCall.js"
import { useAudioLevel, DEFAULT_BINS } from "../react/useAudioLevel.js"
import { DEFAULT_LABELS, type StatusLabels } from "./styles.js"
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js"

export interface AethexVoiceWidgetProps extends UseAethexCallOptions {
  /** Accessible region title. */
  title?: string
  labels?: Partial<StatusLabels>
  /** Number of visualizer bars. Pass a stable value. */
  bins?: number
  className?: string
  style?: CSSProperties
}

const containerStyle: CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderRadius: 12,
}

const barsRowStyle: CSSProperties = { display: "flex", alignItems: "flex-end", gap: 3, height: 28 }

/**
 * Self-contained, accessible voice widget built on {@link useAethexCall}.
 * Renders a status line (announced via `aria-live`), an audio-level visualizer
 * (a static indicator under `prefers-reduced-motion`), and a call/hang-up
 * control with a visible error message on failure.
 */
export function AethexVoiceWidget(props: AethexVoiceWidgetProps) {
  const { title = "Voice call", labels, bins = DEFAULT_BINS, className, style, ...callOptions } = props
  const { status, isConnecting, isConnected, start, stop, remoteStream, error } = useAethexCall(callOptions)
  const { bars } = useAudioLevel(remoteStream, bins)
  const reducedMotion = usePrefersReducedMotion()
  const resolvedLabels: StatusLabels = { ...DEFAULT_LABELS, ...labels }

  const active = isConnected || isConnecting
  // Single source of truth for the announced status, including errors — avoids
  // double/triple announcements from competing live regions.
  const statusText =
    status === "connected"
      ? "In call"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? `Call failed: ${error?.message ?? error?.code ?? "unknown"}`
          : "Ready"

  const buttonLabel =
    status === "connected"
      ? resolvedLabels.connected
      : status === "connecting"
        ? resolvedLabels.connecting
        : status === "error"
          ? resolvedLabels.error
          : resolvedLabels.idle

  return (
    <section
      className={className}
      style={{ ...containerStyle, ...style }}
      role="region"
      aria-label={title}
      data-status={status}
    >
      {/* role="status" already implies aria-live=polite + aria-atomic. The
          single live region carries normal status AND errors (no duplicates). */}
      <p
        role="status"
        style={{ margin: 0, ...(status === "error" ? { color: "var(--aethex-error-color, #b00020)" } : {}) }}
      >
        {statusText}
      </p>

      {isConnected &&
        (reducedMotion ? (
          <span aria-hidden="true">● Live</span>
        ) : (
          <div style={barsRowStyle} aria-hidden="true" data-aethex="visualizer">
            {bars.map((b, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  width: 4,
                  borderRadius: 2,
                  background: "currentColor",
                  height: `${Math.max(2, Math.round(b * 100))}%`,
                }}
              />
            ))}
          </div>
        ))}

      <button
        type="button"
        data-status={status}
        aria-busy={isConnecting || undefined}
        onClick={active ? stop : start}
      >
        {buttonLabel}
      </button>
    </section>
  )
}
