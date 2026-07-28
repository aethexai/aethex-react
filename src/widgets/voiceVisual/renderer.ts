// Animated voice fingerprint renderer — the "Clouds — pixels" (cloudspix) style
// from the standalone prototype (agent-color-embed.js → createVoiceCall). A
// seeded PRNG derives every wave/warp so the same cfg always paints the same
// structure and motion. No dependency, canvas only.

export interface VoiceCfg {
  h: number
  s: number
  l: number
  /** [pitchN, volN, rateN, brightN], each 0..1 */
  norms: [number, number, number, number]
  rate: number
  bright: number
  density: number
  grid: number
  mode: "dark" | "light"
  style: string
  scan: string
  rain: string
  loop: number
  /** Optional pattern salt — forks the seeded structure without touching colour. */
  seedSalt?: number
}

export interface AnimationHandle {
  stop(): void
  drawFrame(t: number): void
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// HSL→RGB written straight into an ImageData buffer — no per-cell array/string
// allocation (the hot path paints thousands of cells per frame).
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}
function hslToBuf(data: Uint8ClampedArray, off: number, h: number, s: number, l: number) {
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
  data[off] = r * 255 // Uint8ClampedArray rounds & clamps
  data[off + 1] = g * 255
  data[off + 2] = b * 255
  data[off + 3] = 255
}

// Mulberry32: deterministic PRNG seeded by the traits → same voice, same shape.
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

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h)
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

/**
 * Paint a voice's animated fingerprint onto ``canvas`` using its ``cfg``.
 * Returns a handle: ``stop()`` cancels the loop, ``drawFrame(t)`` draws a single
 * frame at phase t∈[0,1). Pass ``opts.animate === false`` for a static frame.
 */
export function createVoiceAnimation(
  canvas: HTMLCanvasElement,
  cfg: VoiceCfg,
  opts: { loop?: number; animate?: boolean } = {},
): AnimationHandle {
  const octx = canvas.getContext("2d") as CanvasRenderingContext2D
  const OUT = canvas.width
  const R = OUT * 0.5
  const light = cfg.mode === "light"
  // cloudspix → nearest-neighbor upscale (crisp pixels) + soft cloud warp.
  const pix = true
  const hr = cfg.h
  const st = cfg.s
  const n = {
    pitchN: cfg.norms[0],
    volN: cfg.norms[1],
    rateN: cfg.norms[2],
    brightN: cfg.norms[3],
  }

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
  const field = makeCanvas(G, G)
  const fctx = field.getContext("2d") as CanvasRenderingContext2D
  const fieldImg = fctx.createImageData(G, G)
  const fdata = fieldImg.data

  // Seeded spatio-temporal waves → a field that drifts and loops.
  const waves: { kx: number; ky: number; sp: number; ph: number; sgn: number; amp: number }[] = []
  const nW = 6
  let ampSum = 0
  for (let i = 0; i < nW; i++) {
    const amp = (i < 3 ? 1.0 : 0.45) * (0.7 + rand() * 0.6)
    ampSum += amp
    const maxK = i < 3 ? 3 : 5
    waves.push({
      kx: (1 + Math.floor(rand() * maxK)) * ((2 * Math.PI) / G),
      ky: (1 + Math.floor(rand() * maxK)) * ((2 * Math.PI) / G),
      sp: 1 + Math.floor(rand() * 2),
      ph: rand() * Math.PI * 2,
      sgn: rand() < 0.5 ? -1 : 1,
      amp,
    })
  }

  // Scanlines (cfg.scan: auto/off/fin/moyen/large).
  const scanSet = cfg.scan || "auto"
  const baseP = OUT / (90 + n.rateN * 80)
  let showScan: boolean
  let period: number
  if (scanSet === "off") {
    showScan = false
    period = 9999
  } else {
    showScan = scanSet === "auto" ? cfg.style !== "voicecallpix" : true
    const mult = scanSet === "fin" ? 0.5 : scanSet === "moyen" ? 1 : scanSet === "large" ? 2.2 : gridSet / 50
    period = Math.max(2, Math.round(baseP * mult))
  }
  const scanAlpha = 0.45
  const contrast = 1.35 / (0.6 + 0.5 * density)
  const TAU = Math.PI * 2
  const baseBoost = 0.85 + n.volN * 0.3

  // Cloud warp params: very soft warp + slow oscillating drift (loops on TAU*t).
  const cld = {
    amp: G * (0.06 + n.brightN * 0.05),
    k1: (0.4 + rand() * 0.4) * (TAU / G),
    p1: rand() * TAU,
    k2: (0.4 + rand() * 0.4) * (TAU / G),
    p2: rand() * TAU,
    driftX: (rand() - 0.5) * 0.45,
    driftY: (rand() - 0.5) * 0.3,
  }

  function fieldSum(gx: number, gy: number, t: number): number {
    // Reduced coords (×0.55 → ~2× wider, rounder shapes); whole cycles only
    // (1 cycle = TAU*t) → perfectly seamless loop.
    const wx = cld.amp * Math.sin(cld.k1 * gy + TAU * t + cld.p1)
    const wy = cld.amp * Math.cos(cld.k2 * gx - TAU * t + cld.p2)
    const X = gx * 0.55 + wx + cld.driftX * G * 0.4 * Math.sin(TAU * t)
    const Y = gy * 0.55 + wy + cld.driftY * G * 0.4 * Math.cos(TAU * t)
    let acc = 0
    for (const w of waves) {
      acc += w.amp * Math.sin(w.kx * X + w.sgn * w.ky * Y + TAU * w.sp * t + w.ph)
    }
    return acc / ampSum
  }

  // Soft cloud contrast (constant per frame) hoisted out of the cell loop.
  const cc = 1.2 / (0.6 + 0.5 * density)

  function drawField(t: number) {
    const pulse = baseBoost * (0.78 + 0.32 * (0.5 + 0.5 * Math.sin(TAU * t)))
    let off = 0
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        let v = 0.5 + 0.5 * fieldSum(gx, gy, t)
        v = Math.pow(v, contrast)
        v = Math.pow(v, cc) // round, diffuse shapes, never empty
        const w = clamp((v - 0.42) / 0.58, 0, 1) // 0 = dark base, 1 = white peak
        let L: number
        let S: number
        if (light) {
          L = clamp(96 - v * 54 * pulse, 18, 96)
          S = clamp(st * (0.35 + 0.65 * (1 - v * 0.8)), 0, 100)
        } else {
          L = clamp(v * 80 * pulse + w * 44, 2, 98) // white burst at peaks
          S = clamp(st * (1 - w * 0.88), 0, 100) // desaturate → white
        }
        hslToBuf(fdata, off, hr, S, L)
        off += 4
      }
    }
    fctx.putImageData(fieldImg, 0, 0)
  }

  function draw(t: number) {
    drawField(t)
    octx.save()
    octx.globalCompositeOperation = "source-over"
    octx.fillStyle = light ? "#eef0f5" : "#000"
    octx.fillRect(0, 0, OUT, OUT)
    // circular mask
    octx.beginPath()
    octx.arc(R, R, R, 0, TAU)
    octx.clip()
    octx.imageSmoothingEnabled = !pix
    octx.drawImage(field, 0, 0, G, G, 0, 0, OUT, OUT)

    if (showScan) {
      octx.fillStyle = light ? `rgba(255,255,255,${scanAlpha})` : `rgba(0,0,0,${scanAlpha})`
      for (let x = 0; x < OUT; x += period) octx.fillRect(x, 0, 1, OUT)
    }
    octx.restore()
  }

  if (opts.animate === false) {
    draw(0)
    return { stop() {}, drawFrame: draw }
  }

  const LOOP = (opts.loop || cfg.loop || 5) * 1000
  // Cap the redraw rate: the cloud motion is slow (8s loop), so 30fps is
  // indistinguishable from 60 and halves the CPU. rAF still self-pauses when
  // the tab is backgrounded.
  const minDelta = 1000 / 30
  let raf = 0
  let start: number | null = null
  let lastDrawn = -Infinity
  let stopped = false
  function frame(ts: number) {
    if (stopped) return
    if (start == null) start = ts
    if (ts - lastDrawn >= minDelta) {
      lastDrawn = ts
      draw(((ts - start) % LOOP) / LOOP)
    }
    raf = window.requestAnimationFrame(frame)
  }
  // Respect prefers-reduced-motion: the CSS animations that accompany these
  // canvases already opt out for that preference, so the rAF loop must too —
  // otherwise the fingerprint keeps animating for exactly the users who asked it
  // not to (and burns CPU doing it). Paint one static frame instead.
  const reduceMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (reduceMotion) {
    draw(0)
    return {
      stop() {
        stopped = true
      },
      drawFrame: draw,
    }
  }
  raf = window.requestAnimationFrame(frame)
  return {
    stop() {
      stopped = true
      window.cancelAnimationFrame(raf)
    },
    drawFrame: draw,
  }
}
