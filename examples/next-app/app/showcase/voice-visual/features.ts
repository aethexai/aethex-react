// Color / animated fingerprint from a voice NAME (no audio). Ported from the
// prototype (name.js). The name (+ metadata) is hashed stably, then mapped to
// "synthetic" voice traits in the same ranges as real audio analysis — so the
// same name always yields the same color / fingerprint / animation.
import { featuresToColor, type VoiceColor, type VoiceFeatures } from "./color"

export interface VoiceMeta {
  name: string
  language?: string | null
  country?: string | null
  gender?: string | null
}

// FNV-1a 32-bit: deterministic, dependency-free, good dispersion.
function hash32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Hash key: name + language/country/gender when present, so homonyms with a
// different country/gender/language get distinct colors while staying stable.
function hashKey({ name, language, country, gender }: VoiceMeta): string {
  return [name, language, country, gender].map((v) => (v ? String(v).trim().toLowerCase() : "")).join("|")
}

// name → synthetic voice traits (same ranges the audio path feeds color.ts).
export function nameToFeatures(meta: VoiceMeta): VoiceFeatures {
  const h = hash32(hashKey(meta))
  // 4 quasi-independent channels drawn from distinct bytes of the hash.
  const u = (shift: number) => ((h >>> shift) & 0xff) / 255
  return {
    pitch: 80 + u(0) * (320 - 80),
    volumeDb: -42 + u(8) * (-8 - -42),
    rate: 2.2 + u(16) * (6.5 - 2.2),
    bright: 700 + u(24) * (3800 - 700),
  }
}

export function colorFromName(meta: VoiceMeta): { features: VoiceFeatures; color: VoiceColor } {
  const features = nameToFeatures(meta)
  return { features, color: featuresToColor(features) }
}
