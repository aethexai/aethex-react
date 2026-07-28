import type { CSSProperties } from "react"

/** Visually hidden but available to assistive tech. */
export const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
}

/** Status → human label, shared by the widgets and their aria-live regions. */
export interface StatusLabels {
  idle: string
  connecting: string
  connected: string
  error: string
}

export const DEFAULT_LABELS: StatusLabels = {
  idle: "Start call",
  connecting: "Connecting…",
  connected: "End call",
  error: "Call failed — retry",
}
