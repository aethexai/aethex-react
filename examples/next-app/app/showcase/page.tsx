"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { AethexVoiceOrb } from "@aethexai/react/widgets"
// The raw fingerprint engine is internal to the package, so the demo vendors its
// own copy (see ./voice-visual) to drive the animated gallery directly.
import { voiceCfg, createVoiceAnimation, type VoiceCfg } from "./voice-visual"

// The same texture presets the SDK's <AethexVoiceOrb orbType> uses (internal in
// the widget). Here we drive the raw engine directly so the gallery can animate
// on demand and stay call-free.
const VARIANT: Record<string, Pick<VoiceCfg, "grid" | "scan" | "density" | "seedSalt">> = {
  pixel: { grid: 20, scan: "large", density: 1.5, seedSalt: 11 },
  pulse: { grid: 30, scan: "moyen", density: 1.25, seedSalt: 22 },
  aurora: { grid: 46, scan: "fin", density: 1.0, seedSalt: 0 },
  fluid: { grid: 60, scan: "off", density: 0.9, seedSalt: 33 },
  liquid: { grid: 72, scan: "fin", density: 1.45, seedSalt: 44 },
}
const VARIANTS = ["pixel", "pulse", "aurora", "fluid", "liquid"] as const
const VARIANT_NOTE: Record<string, string> = {
  pixel: "chunky · bold scanlines",
  pulse: "medium · punchy",
  aurora: "studio default",
  fluid: "fine · flowing",
  liquid: "smooth · no lines",
}
const AGENTS = ["Mary", "Jolly Wanjiru", "Tunde", "Relationship Manager", "Kora", "Aethex Infra"]

/** Raw-engine orb (no call, no button) — for the visual gallery. */
function Orb({
  name,
  variant = "aurora",
  size = 88,
  animate,
}: {
  name: string
  variant?: string
  size?: number
  animate: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(size * dpr)
    c.height = c.width
    const cfg: VoiceCfg = { ...voiceCfg({ name }, { mode: "dark" }), ...VARIANT[variant] }
    const h = createVoiceAnimation(c, cfg, { animate, loop: 8 })
    return () => h.stop()
  }, [name, variant, size, animate])
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: "50%", display: "block" }} />
}

const muted = "rgba(231,234,243,0.55)"
const card: CSSProperties = {
  padding: 18,
  borderRadius: 16,
  border: "1px solid rgba(231,234,243,0.08)",
  background: "rgba(231,234,243,0.02)",
}
const h2: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: muted,
  margin: "0 0 16px",
}
function pill(active: boolean): CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 999,
    border: "1px solid rgba(231,234,243,0.14)",
    background: active ? "rgba(56,128,255,0.2)" : "rgba(231,234,243,0.05)",
    color: "#E7EAF3",
    fontSize: 13,
    cursor: "pointer",
  }
}

export default function Showcase() {
  const [animate, setAnimate] = useState(true)
  const [variant, setVariant] = useState<(typeof VARIANTS)[number]>("aurora")
  const [name, setName] = useState("Kora")
  const [tab, setTab] = useState(0)

  return (
    <div
      style={{
        minHeight: "100vh",
        color: "#E7EAF3",
        fontFamily: "system-ui, sans-serif",
        background:
          "radial-gradient(80% 60% at 25% 15%, rgba(56,128,255,0.18), transparent 70%)," +
          "radial-gradient(55% 50% at 85% 25%, rgba(140,90,220,0.14), transparent 72%)," +
          "linear-gradient(180deg, #04050e 0%, #060810 52%, #03040a 100%)",
      }}
    >
      <main
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "64px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 40,
        }}
      >
        {/* Hero + live controls */}
        <section style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
          <Orb name={name || " "} variant={variant} size={132} animate={animate} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 240 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Voice orb</h1>
              <p style={{ color: muted, fontSize: 14, marginTop: 6, lineHeight: 1.55 }}>
                One base — Agent Studio&apos;s voice fingerprint. Colour is seeded from the name; the variant
                changes the texture. Still at rest, animates on a call.
              </p>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="agent name"
              style={{
                background: "rgba(231,234,243,0.06)",
                border: "1px solid rgba(231,234,243,0.14)",
                color: "#E7EAF3",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 14,
                width: 200,
              }}
            />
            <button
              type="button"
              onClick={() => setAnimate((v) => !v)}
              style={{ ...pill(animate), width: "fit-content" }}
            >
              {animate ? "◼ Rest (idle)" : "▶ Animate (in-call)"}
            </button>
          </div>
        </section>

        {/* The 5 texture variants — same name, so only the texture differs */}
        <section>
          <h2 style={h2}>Variants — same agent, different texture</h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}
          >
            {VARIANTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVariant(v)}
                style={{
                  ...card,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  outline: variant === v ? "2px solid rgba(56,128,255,0.7)" : "none",
                }}
              >
                <Orb name={name || "Kora"} variant={v} size={92} animate={animate} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{v}</span>
                <span style={{ fontSize: 11, color: muted }}>{VARIANT_NOTE[v]}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Colour = identity: same variant, different names */}
        <section>
          <h2 style={h2}>Colour is the identity — seeded from the name</h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14 }}
          >
            {AGENTS.map((a) => (
              <div
                key={a}
                style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}
              >
                <Orb name={a} variant={variant} size={72} animate={animate} />
                <span style={{ fontSize: 12, color: "rgba(231,234,243,0.72)", textAlign: "center" }}>
                  {a}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Presentation variants */}
        <section>
          <h2 style={h2}>Same orb, different placements</h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}
          >
            {/* In a card */}
            <div style={card}>
              <p
                style={{
                  fontSize: 11,
                  color: muted,
                  margin: "0 0 12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
              >
                In a card
              </p>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <Orb name={name || "Kora"} variant={variant} size={56} animate={animate} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{name || "Kora"}</div>
                  <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>English · aethex-default</div>
                </div>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    border: "1px solid rgba(231,234,243,0.16)",
                    borderRadius: 8,
                    padding: "5px 10px",
                  }}
                >
                  Test
                </span>
              </div>
            </div>

            {/* In tabs */}
            <div style={card}>
              <p
                style={{
                  fontSize: 11,
                  color: muted,
                  margin: "0 0 12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
              >
                In tabs
              </p>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {AGENTS.slice(0, 3).map((a, i) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setTab(i)}
                    style={{ ...pill(tab === i), fontSize: 12, padding: "5px 10px" }}
                  >
                    {a.split(" ")[0]}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <Orb name={AGENTS[tab] ?? "Kora"} variant={variant} size={64} animate={animate} />
                <div style={{ fontSize: 14 }}>{AGENTS[tab]}</div>
              </div>
            </div>

            {/* The real widget (capsule) */}
            <div style={card}>
              <p
                style={{
                  fontSize: 11,
                  color: muted,
                  margin: "0 0 12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                }}
              >
                The widget — &lt;AethexVoiceOrb&gt;
              </p>
              <AethexVoiceOrb
                agentId="00000000-0000-0000-0000-000000000000"
                apiBaseUrl="http://localhost:8787"
                agentName={name || "Kora"}
                orbType={variant}
                title={`Talk to ${name || "Kora"}`}
                theme="dark"
                size="lg"
                float={false}
              />
              <p style={{ fontSize: 11, color: "rgba(231,234,243,0.4)", marginTop: 10 }}>
                Tapping starts a real call (animates then). It&apos;s a placeholder proxy here, so it&apos;ll
                error — the point is the resting look.
              </p>
            </div>
          </div>
        </section>

        {/* Video variant still supported */}
        <section>
          <h2 style={h2}>Video variant — still supported</h2>
          <p style={{ color: muted, fontSize: 13, margin: "-6px 0 0" }}>
            Pass <code>videoSrc</code> to render a pre-rendered clip instead of the fingerprint (e.g. the
            floating orb on the main demo page). Everything else — float, size, labels — is unchanged.
          </p>
        </section>
      </main>
    </div>
  )
}
