export { AethexCallButton } from "./AethexCallButton.js"
export type { AethexCallButtonProps } from "./AethexCallButton.js"
export { AethexVoiceWidget } from "./AethexVoiceWidget.js"
export type { AethexVoiceWidgetProps } from "./AethexVoiceWidget.js"
export { AethexVoiceOrb } from "./AethexVoiceOrb.js"
export type { AethexVoiceOrbProps, AethexVoiceOrbLabels } from "./AethexVoiceOrb.js"
export type { OrbType } from "./AethexVoiceOrb.js"
// The orb component is the public API. `voiceColorHex` is a small, stable helper
// (agent/voice name → its deterministic hex colour) for theming around the orb.
// The raw canvas engine (voiceCfg / createVoiceAnimation) stays internal — its
// config shape is an implementation detail we don't want to freeze as public API.
export { voiceColorHex } from "./voiceVisual/index.js"
export type { VoiceMeta } from "./voiceVisual/index.js"
export { usePrefersReducedMotion } from "./usePrefersReducedMotion.js"
export type { StatusLabels } from "./styles.js"
