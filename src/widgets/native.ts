// React Native widgets entry — Metro resolves it via the `./widgets`
// `react-native` export condition, so `import { AethexVoiceOrb } from
// "@aethexai/react/widgets"` renders the Skia orb on iOS/Android and the DOM
// canvas orb on web, from the same import.
//
// Native peers: react-native, react-native-webrtc, @shopify/react-native-skia
// (+ its react-native-reanimated), react-native-incall-manager. See the README.
export { AethexVoiceOrb } from "./AethexVoiceOrb.native.js"
export type { AethexVoiceOrbProps, AethexVoiceOrbLabels, OrbType } from "./AethexVoiceOrb.native.js"

// Shared, platform-agnostic helper (cheap colour from a name — no canvas/Skia).
export { voiceColorHex } from "./voiceVisual/index.js"
export type { VoiceMeta } from "./voiceVisual/index.js"
