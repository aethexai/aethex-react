// Voice traits → color. Ported from the standalone prototype (color.js).
//   pitch  → hue   : low = warm (red), high = cool (blue/violet)
//   volume → light : louder = brighter
//   rate   → sat   : faster = more vivid
//   bright → fine hue nudge + light contribution
// Deterministic: same features → same color.

export interface VoiceFeatures {
  pitch: number
  volumeDb: number
  rate: number
  bright: number
}

export interface VoiceColor {
  hue: number
  sat: number
  light: number
  rgb: [number, number, number]
  hex: string
  css: string
  norms: { pitchN: number; volN: number; rateN: number; brightN: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const norm = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1)

export function featuresToColor(f: VoiceFeatures): VoiceColor {
  const pitchN = norm(f.pitch || 130, 80, 320) // 0 low .. 1 high
  const volN = norm(f.volumeDb, -42, -8) //       0 quiet .. 1 loud
  const rateN = norm(f.rate, 2.2, 6.5) //         0 slow .. 1 fast
  const brightN = norm(f.bright || 1500, 700, 3800) // 0 dull .. 1 bright

  // Hue: low → 8° (red/orange), high → 280° (violet) via blue. Timbre nudges it
  // so nearby voices stay distinct.
  let hue = 8 + pitchN * 272 + (brightN - 0.5) * 24
  hue = (hue + 360) % 360

  const sat = Math.round((0.45 + rateN * 0.5) * 100) // 45..95 %
  const light = Math.round((0.34 + volN * 0.34 + brightN * 0.08) * 100) // ~34..76 %

  const rgb = hslToRgb(hue, sat, light)
  return {
    hue,
    sat,
    light,
    rgb,
    hex: rgbToHex(rgb),
    css: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    norms: { pitchN, volN, rateN, brightN },
  }
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360
  s /= 100
  l /= 100
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

const toHex = (n: number) => n.toString(16).padStart(2, "0")
export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}
