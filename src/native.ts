/**
 * React Native / Expo entry for `@aethexai/react`.
 *
 * Metro resolves this file (via the package's `react-native` field / export
 * condition) instead of the web entry, so `import { useAethexCall } from
 * "@aethexai/react"` works the same in a React Native or Expo app. It is the
 * full SDK with the WebRTC + audio layer bound to `react-native-webrtc`, so no
 * browser globals are touched.
 *
 * Peer deps for the native target: `react-native`, `react-native-webrtc` (and a
 * dev build — this cannot run in Expo Go). See the README's React Native section
 * and `examples/expo-app`.
 */
import { VoiceCall as VoiceCallCore, type VoiceCallOptions } from "./core/VoiceCall.js"
import {
  useAethexCall as useAethexCallCore,
  type UseAethexCallOptions,
  type UseAethexCallResult,
} from "./react/useAethexCall.js"
import { nativePlatform } from "./native/platform.js"

/** {@link VoiceCallCore} bound to the React Native (`react-native-webrtc`) platform. */
export class VoiceCall extends VoiceCallCore {
  constructor(options: VoiceCallOptions) {
    super({ ...options, platform: options.platform ?? nativePlatform })
  }
}

/** {@link useAethexCallCore} bound to the React Native platform. */
export function useAethexCall(options: UseAethexCallOptions): UseAethexCallResult {
  return useAethexCallCore({ ...options, platform: options.platform ?? nativePlatform })
}

export { nativePlatform }

// Everything below is platform-agnostic and re-exported unchanged from the core
// / React layers (useAudioLevel degrades to a flat 0 level in RN — no Web Audio).
export { Transport } from "./core/transport.js"
export { webPlatform, type WebRTCPlatform } from "./core/platform.js"
export { AethexError, isAethexError, fromMediaError } from "./core/errors.js"
export type { AethexErrorCode, AethexErrorOptions } from "./core/errors.js"
export { noopLogger } from "./core/logger.js"
export type { Logger } from "./core/logger.js"
export type {
  AethexCallConfig,
  AethexEndpoints,
  CallStatus,
  ConnectResponse,
  IceConfig,
  IceCandidatePayload,
  OfferResponse,
  PipelineMetrics,
  SessionStatusResponse,
} from "./core/types.js"
export type { VoiceCallOptions, VoiceCallCallbacks } from "./core/VoiceCall.js"
export { useAudioLevel, useAudioLevelRef, DEFAULT_BINS } from "./react/useAudioLevel.js"
export type { AudioLevel } from "./react/useAudioLevel.js"
export { getTranscript } from "./react/getTranscript.js"
export type { GetTranscriptOptions, TranscriptTurn } from "./react/getTranscript.js"
export type { UseAethexCallOptions, UseAethexCallResult } from "./react/useAethexCall.js"
