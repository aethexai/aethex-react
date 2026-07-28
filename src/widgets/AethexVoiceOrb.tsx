import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useAethexCall, type UseAethexCallOptions } from "../react/useAethexCall.js"
import { srOnly } from "./styles.js"
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js"
import { voiceCfg, createVoiceAnimation, type VoiceCfg } from "./voiceVisual/index.js"
import { ORB_CSS, ORB_STYLE_ID } from "./orbStyles.js"

/** Every user-facing string, all optional — sensible defaults fill the gaps. */
export interface AethexVoiceOrbLabels {
  /** Status line per phase (idle falls back to `title`). */
  idle?: string
  connecting?: string
  connected?: string
  failed?: string
  /** Sub-line shown at rest (falls back to the `description` prop). */
  description?: string
  /** Error sub-line; falls back to the error's message. */
  failedDescription?: string
  /** Accessible action labels for the orb button. */
  startAction?: string
  stopAction?: string
}

/**
 * Orb texture variant. The base is always the deterministic **voice fingerprint**
 * — the same `voice-visual` engine Agent Studio uses, with colour seeded from the
 * voice/agent. A variant only changes the *texture* (pixel size, scanlines,
 * contrast), not the colour. The five names are kept for back-compat; they no
 * longer select separate renderers. Tuned to be clearly distinguishable:
 * `pixel` (chunky, bold scanlines) → `liquid` (finest, smooth, no lines).
 */
export type OrbType = "aurora" | "pulse" | "liquid" | "pixel" | "fluid"

// Texture knobs per variant (colour still comes from the seed). Spread wide so
// each is obviously different, not a subtle tweak.
const VARIANT: Record<OrbType, Pick<VoiceCfg, "grid" | "scan" | "density" | "seedSalt">> = {
  // `seedSalt` forks the pattern so each variant is a *different structure* (not
  // just a re-pixelation of the same blob); colour still comes from the seed.
  pixel: { grid: 20, scan: "large", density: 1.5, seedSalt: 11 }, // chunky blocks + bold scanlines
  pulse: { grid: 30, scan: "moyen", density: 1.25, seedSalt: 22 }, // medium blocks, punchy
  aurora: { grid: 46, scan: "fin", density: 1.0, seedSalt: 0 }, // Agent Studio default — fine
  fluid: { grid: 60, scan: "off", density: 0.9, seedSalt: 33 }, // fine, smooth, no scanlines
  liquid: { grid: 72, scan: "fin", density: 1.45, seedSalt: 44 }, // finest, soft, faint lines
}

const ORB_PX: Record<"sm" | "md" | "lg", number> = { sm: 38, md: 48, lg: 60 }

export interface AethexVoiceOrbProps extends UseAethexCallOptions {
  /** Idle status line + accessible region name. */
  title?: string
  /** Idle sub-line (shorthand for `labels.description`). */
  description?: string
  /** Override any user-facing string. */
  labels?: AethexVoiceOrbLabels

  /**
   * Texture variant of the voice-fingerprint orb (colour is always seeded from
   * the voice/agent). One of `aurora` (Agent Studio default), `pulse`, `fluid`,
   * `liquid`, `pixel`. Ignored when {@link videoSrc} is set.
   */
  orbType?: OrbType
  /**
   * Seed for the fingerprint's colour + pattern. Defaults to the `agentId`, so
   * each agent gets its own stable orb. Pass an agent's display name to match the
   * exact colour it shows in Agent Studio.
   */
  voiceName?: string
  /**
   * Video orb source. When set, the orb renders a looping, muted `<video>`
   * (circle-masked) instead of the fingerprint — drop in a pre-rendered clip.
   * Pass one URL for every phase, or a per-phase map
   * (`{ idle, connecting, incall, error }`). Serve heavy clips from your app/CDN,
   * not your JS bundle. Paused at rest (a still frame).
   */
  videoSrc?: string | Partial<Record<Phase, string>>

  /** Capsule accent (focus ring etc.). The orb colour comes from the seed, not this. */
  accent?: string
  /** Reserved for capsule theming; no longer tints the orb. */
  accent2?: string
  /** Container border color. */
  border?: string
  /** Container background color. */
  surface?: string
  /** Primary text color (defaults to the theme's). */
  textColor?: string
  /** Muted / sub-line text color. */
  mutedColor?: string
  /** Font family. Omit to inherit the host app's font. */
  font?: string

  /** Light/dark chrome — also sets the fingerprint's dark/light rendering. */
  theme?: "light" | "dark"
  /** Overall component size. */
  size?: "sm" | "md" | "lg"

  /**
   * Pin the orb to a screen corner as a floating action button (`position:
   * fixed`). Defaults to `true` → bottom-right. Pass a corner to move it, or
   * `false` to render inline in the normal document flow.
   */
  float?: boolean | FloatCorner
  /** Distance (px, or any CSS length) from the screen edges when floating. Default `24`. */
  floatOffset?: number | string
  /** Stacking order when floating. Default `9999`. */
  zIndex?: number

  className?: string
  style?: CSSProperties
}

type Phase = "idle" | "connecting" | "incall" | "error"
type FloatCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left"

function injectStyles(): void {
  if (typeof document === "undefined" || document.getElementById(ORB_STYLE_ID)) return
  const el = document.createElement("style")
  el.id = ORB_STYLE_ID
  el.textContent = ORB_CSS
  document.head.appendChild(el)
}

/**
 * Inline voice widget where the orb *is* the button. The orb is the deterministic
 * voice fingerprint (Agent Studio's `voice-visual` engine): colour + pattern are
 * seeded from `voiceName` (or the agent id), it holds a **single static frame at
 * rest**, and self-animates only while connecting / in a call. Tapping starts the
 * call; the capsule then extends to show status + an in-call timer. Tapping again
 * hangs up. SSR-safe and honors `prefers-reduced-motion`.
 */
export function AethexVoiceOrb(props: AethexVoiceOrbProps) {
  const {
    title,
    description,
    labels = {},
    orbType = "aurora",
    voiceName,
    videoSrc,
    accent = "#7C6CFF",
    accent2 = "#34E3C4",
    border,
    surface,
    textColor,
    mutedColor,
    font,
    theme = "light",
    size = "md",
    float = true,
    floatOffset = 24,
    zIndex = 9999,
    className,
    style,
    ...callOptions
  } = props

  // Floating (fixed) placement. `float === true` → bottom-right; a corner string
  // picks another; `false` keeps the orb inline.
  const corner: FloatCorner | null = float === true ? "bottom-right" : float || null
  const floatStyle: CSSProperties = corner
    ? (() => {
        const off = typeof floatOffset === "number" ? `${floatOffset}px` : floatOffset
        const [v, h] = corner.split("-") as [string, string]
        return { position: "fixed", zIndex, [v]: off, [h]: off } as CSSProperties
      })()
    : {}

  const { status, isConnecting, isConnected, start, stop, error } = useAethexCall(callOptions)
  const reduced = usePrefersReducedMotion()
  const [seconds, setSeconds] = useState(0)

  const phase: Phase =
    status === "connected"
      ? "incall"
      : status === "connecting"
        ? "connecting"
        : status === "error"
          ? "error"
          : "idle"
  const active = isConnected || isConnecting
  // Motion only while connecting or in a call — still at rest.
  const animatedPhase = phase === "connecting" || phase === "incall"

  // Video mode: resolve the clip for this phase (string = same clip everywhere).
  const resolvedVideoSrc =
    typeof videoSrc === "string"
      ? videoSrc
      : videoSrc
        ? (videoSrc[phase] ?? videoSrc.incall ?? videoSrc.idle ?? videoSrc.connecting ?? videoSrc.error)
        : undefined

  useEffect(() => injectStyles(), [])

  // Call timer (resets whenever we (re)enter the connected state).
  useEffect(() => {
    if (status !== "connected") {
      setSeconds(0)
      return
    }
    setSeconds(0)
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  // Voice-fingerprint canvas — Agent Studio's `voice-visual` engine. Colour +
  // texture are seeded from `voiceName` (or the agent id); the engine loops while
  // connecting / in-call and paints a single static frame otherwise.
  const seed = voiceName ?? props.agentId ?? "aethex"
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (resolvedVideoSrc) return // video mode: no fingerprint
    const canvas = canvasRef.current
    // No real 2D context (jsdom / SSR shims) → skip; the engine needs one.
    if (!canvas || typeof canvas.getContext !== "function" || !canvas.getContext("2d")) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssPx = Math.round(canvas.getBoundingClientRect().width) || ORB_PX[size]
    canvas.width = Math.round(cssPx * dpr)
    canvas.height = canvas.width
    const cfg: VoiceCfg = { ...voiceCfg({ name: seed }, { mode: theme }), ...VARIANT[orbType] }
    const handle = createVoiceAnimation(canvas, cfg, { animate: animatedPhase, loop: 8 })
    return () => handle.stop()
  }, [seed, orbType, theme, size, animatedPhase, resolvedVideoSrc, reduced])

  // Video mode: keep it muted; play only while connecting / in-call, else a still frame.
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    try {
      if (reduced || !animatedPhase) {
        v.pause()
      } else {
        const p = v.play() as Promise<void> | undefined
        p?.catch(() => {}) // autoplay may be blocked; harmless
      }
    } catch {
      // media element not fully implemented (e.g. jsdom) — ignore
    }
  }, [reduced, resolvedVideoSrc, animatedPhase])

  // At idle the status line is the title (may be undefined → orb-only mode).
  const statusLine =
    phase === "incall"
      ? (labels.connected ?? "In call")
      : phase === "connecting"
        ? (labels.connecting ?? "Connecting…")
        : phase === "error"
          ? (labels.failed ?? "Couldn’t connect")
          : (labels.idle ?? title)

  const timer = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  // A muted sub-line only at rest (description) or on error (the reason).
  const sub =
    phase === "idle"
      ? (labels.description ?? description ?? null)
      : phase === "error"
        ? (labels.failedDescription ?? error?.message ?? null)
        : null

  // No title (and no sub) at idle → render just the orb as a round button.
  const showBody = Boolean(statusLine) || Boolean(sub)
  const orbOnly = !showBody
  const actionName = active
    ? (labels.stopAction ?? "End voice call")
    : (labels.startAction ?? "Start voice call")
  const ariaLabel = statusLine ? `${statusLine} — ${actionName}` : actionName

  const announce =
    phase === "incall"
      ? "In call"
      : phase === "connecting"
        ? "Connecting"
        : phase === "error"
          ? `Call failed: ${error?.code ?? "unknown"}`
          : "Idle"

  const vars: Record<string, string> = {
    "--aethex-accent": accent,
    "--aethex-accent-2": accent2,
  }
  if (border) vars["--aethex-c-line"] = border
  if (surface) vars["--aethex-surface"] = surface
  if (textColor) vars["--aethex-ink"] = textColor
  if (mutedColor) vars["--aethex-dim"] = mutedColor
  if (font) vars["--aethex-font"] = font
  const rootStyle = { ...vars, ...floatStyle, ...style } as CSSProperties

  return (
    <>
      <button
        type="button"
        className={["aethex-orb", className].filter(Boolean).join(" ")}
        style={rootStyle}
        data-state={phase}
        data-theme={theme}
        data-size={size}
        data-orb-only={orbOnly}
        data-float={corner ?? undefined}
        aria-pressed={active}
        aria-busy={isConnecting || undefined}
        aria-label={ariaLabel}
        onClick={active ? stop : start}
      >
        <span className="aethex-orb__orb">
          {resolvedVideoSrc ? (
            <video
              ref={videoRef}
              key={resolvedVideoSrc}
              src={resolvedVideoSrc}
              muted
              loop
              playsInline
              autoPlay={false}
              preload="auto"
              aria-hidden="true"
            />
          ) : (
            <canvas ref={canvasRef} aria-hidden="true" />
          )}
        </span>

        {showBody && (
          <span className="aethex-orb__body">
            {statusLine && (
              <span className="aethex-orb__label">
                <span className="aethex-orb__txt">{statusLine}</span>
                {phase === "incall" && (
                  <span className="aethex-orb__time" aria-hidden="true">
                    · {timer}
                  </span>
                )}
              </span>
            )}
            {sub && (
              <span className="aethex-orb__sub" aria-hidden="true">
                {sub}
              </span>
            )}
          </span>
        )}
      </button>

      <span role="status" aria-live="polite" style={srOnly}>
        {announce}
      </span>
    </>
  )
}
