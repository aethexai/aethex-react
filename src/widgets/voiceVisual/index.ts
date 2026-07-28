// Voice visual — deterministic color + animated fingerprint derived purely from
// a voice's name and metadata (no audio, no external asset). Used by the voice
// picker (avatar) and the voice test screen.

import { colorFromName, type VoiceMeta } from "./features.js"
import { type VoiceCfg } from "./renderer.js"

export { colorFromName, nameToFeatures, type VoiceMeta } from "./features.js"
export { featuresToColor, type VoiceColor, type VoiceFeatures } from "./color.js"
export { createVoiceAnimation, type VoiceCfg, type AnimationHandle } from "./renderer.js"

// Assemble the compact config the renderer consumes, matching the "By name"
// preset: Clouds — pixels, fine scanlines, medium pixels, 8s loop.
export function voiceCfg(meta: VoiceMeta, opts: { mode?: "dark" | "light" } = {}): VoiceCfg {
  const { features, color } = colorFromName(meta)
  return {
    h: color.hue,
    s: color.sat,
    l: color.light,
    norms: [color.norms.pitchN, color.norms.volN, color.norms.rateN, color.norms.brightN],
    rate: features.rate,
    bright: features.bright,
    density: 1, // Normal
    grid: 50, // Pixel size = Medium
    mode: opts.mode ?? "dark",
    style: "cloudspix", // Clouds — pixels
    scan: "fin", // Scanlines = Fine
    rain: "off",
    loop: 8, // slowed loop for the name mode
  }
}

/** Just the derived accent color (hex) for a voice — cheap, no canvas. */
export function voiceColorHex(meta: VoiceMeta): string {
  return colorFromName(meta).color.hex
}
