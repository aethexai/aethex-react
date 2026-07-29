// React Native port of the voice-fingerprint renderer (src/widgets/voiceVisual/
// renderer.ts). The heavy math is identical — a seeded spatio-temporal wave
// field → an HSL→RGBA pixel buffer. The web version pushes that buffer into a
// canvas via putImageData; here we just RETURN the buffer, and SkiaOrb wraps it
// as an SkImage. Same seed + cfg → same orb as the web SDK.
import { colorFromName } from "./features.js"

export type OrbType = "aurora" | "pulse" | "liquid" | "fluid" | "pixel"

// The same texture presets the SDK's <AethexVoiceOrb orbType> uses.
const VARIANT: Record<OrbType, { grid: number; scan: string; density: number; seedSalt: number }> = {
  pixel: { grid: 20, scan: "large", density: 1.5, seedSalt: 11 },
  pulse: { grid: 30, scan: "moyen", density: 1.25, seedSalt: 22 },
  aurora: { grid: 46, scan: "fin", density: 1.0, seedSalt: 0 },
  fluid: { grid: 60, scan: "off", density: 0.9, seedSalt: 33 },
  liquid: { grid: 72, scan: "fin", density: 1.45, seedSalt: 44 },
}

export interface Cfg {
  h: number
  s: number
  l: number
  norms: [number, number, number, number]
  rate: number
  bright: number
  density: number
  grid: number
  mode: "dark" | "light"
  scan: string
  seedSalt: number
}

/** Build a cfg from an agent name + texture — mirrors the SDK's `voiceCfg`. */
export function makeCfg(agentName: string, orbType: OrbType, mode: "dark" | "light"): Cfg {
  const { features, color } = colorFromName({ name: agentName })
  const v = VARIANT[orbType]
  return {
    h: color.hue,
    s: color.sat,
    l: color.light,
    norms: [color.norms.pitchN, color.norms.volN, color.norms.rateN, color.norms.brightN],
    rate: features.rate,
    bright: features.bright,
    density: v.density,
    grid: v.grid,
    mode,
    scan: v.scan,
    seedSalt: v.seedSalt,
  }
}

const clampf = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToBuf(data: Uint8Array, off: number, h: number, s: number, l: number) {
  h /= 360
  s /= 100
  l /= 100
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  data[off] = clampf(Math.round(r * 255), 0, 255)
  data[off + 1] = clampf(Math.round(g * 255), 0, 255)
  data[off + 2] = clampf(Math.round(b * 255), 0, 255)
  data[off + 3] = 255
}

// Mulberry32 — deterministic PRNG seeded by the traits.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Fingerprint {
  /** field resolution (G×G) */
  G: number
  scan: { show: boolean; period: number; alpha: number }
  /** RGBA buffer (G*G*4) for phase t∈[0,1). Fresh allocation each call. */
  render(t: number): Uint8Array
}

export function makeFingerprint(cfg: Cfg, outSize: number): Fingerprint {
  const light = cfg.mode === "light"
  const hr = cfg.h
  const st = cfg.s
  const n = { pitchN: cfg.norms[0], volN: cfg.norms[1], rateN: cfg.norms[2], brightN: cfg.norms[3] }

  const seed =
    Math.floor(
      (hr * 1000 +
        st * 31 +
        (cfg.l || 0) * 7 +
        (cfg.rate || 0) * 97 +
        (cfg.bright || 0) +
        (cfg.seedSalt || 0) * 1013) |
        0,
    ) >>> 0
  const rand = rng(seed)

  const gridSet = cfg.grid || 50
  const density = cfg.density != null ? cfg.density : 1
  const G = Math.max(18, Math.min(72, Math.round(gridSet * 0.9)))

  const TAU = Math.PI * 2
  const waves: { kx: number; ky: number; sp: number; ph: number; sgn: number; amp: number }[] = []
  let ampSum = 0
  for (let i = 0; i < 6; i++) {
    const amp = (i < 3 ? 1.0 : 0.45) * (0.7 + rand() * 0.6)
    ampSum += amp
    const maxK = i < 3 ? 3 : 5
    waves.push({
      kx: (1 + Math.floor(rand() * maxK)) * (TAU / G),
      ky: (1 + Math.floor(rand() * maxK)) * (TAU / G),
      sp: 1 + Math.floor(rand() * 2),
      ph: rand() * Math.PI * 2,
      sgn: rand() < 0.5 ? -1 : 1,
      amp,
    })
  }

  const scanSet = cfg.scan || "auto"
  const baseP = outSize / (90 + n.rateN * 80)
  let showScan: boolean
  let period: number
  if (scanSet === "off") {
    showScan = false
    period = 9999
  } else {
    showScan = true
    const mult = scanSet === "fin" ? 0.5 : scanSet === "moyen" ? 1 : scanSet === "large" ? 2.2 : gridSet / 50
    period = Math.max(2, Math.round(baseP * mult))
  }

  const contrast = 1.35 / (0.6 + 0.5 * density)
  const baseBoost = 0.85 + n.volN * 0.3
  const cld = {
    amp: G * (0.06 + n.brightN * 0.05),
    k1: (0.4 + rand() * 0.4) * (TAU / G),
    p1: rand() * TAU,
    k2: (0.4 + rand() * 0.4) * (TAU / G),
    p2: rand() * TAU,
    driftX: (rand() - 0.5) * 0.45,
    driftY: (rand() - 0.5) * 0.3,
  }
  const cc = 1.2 / (0.6 + 0.5 * density)

  function fieldSum(gx: number, gy: number, t: number): number {
    const wx = cld.amp * Math.sin(cld.k1 * gy + TAU * t + cld.p1)
    const wy = cld.amp * Math.cos(cld.k2 * gx - TAU * t + cld.p2)
    const X = gx * 0.55 + wx + cld.driftX * G * 0.4 * Math.sin(TAU * t)
    const Y = gy * 0.55 + wy + cld.driftY * G * 0.4 * Math.cos(TAU * t)
    let acc = 0
    for (const w of waves) acc += w.amp * Math.sin(w.kx * X + w.sgn * w.ky * Y + TAU * w.sp * t + w.ph)
    return acc / ampSum
  }

  function render(t: number): Uint8Array {
    const buf = new Uint8Array(G * G * 4)
    const pulse = baseBoost * (0.78 + 0.32 * (0.5 + 0.5 * Math.sin(TAU * t)))
    let off = 0
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        let v = 0.5 + 0.5 * fieldSum(gx, gy, t)
        v = Math.pow(v, contrast)
        v = Math.pow(v, cc)
        const w = clampf((v - 0.42) / 0.58, 0, 1)
        let L: number
        let S: number
        if (light) {
          L = clampf(96 - v * 54 * pulse, 18, 96)
          S = clampf(st * (0.35 + 0.65 * (1 - v * 0.8)), 0, 100)
        } else {
          L = clampf(v * 80 * pulse + w * 44, 2, 98)
          S = clampf(st * (1 - w * 0.88), 0, 100)
        }
        hslToBuf(buf, off, hr, S, L)
        off += 4
      }
    }
    return buf
  }

  return { G, scan: { show: showScan, period, alpha: 0.45 }, render }
}
