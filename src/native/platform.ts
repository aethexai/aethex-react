import { RTCPeerConnection, mediaDevices } from "react-native-webrtc"
// eslint-disable-next-line @typescript-eslint/naming-convention -- the module's default export
import InCallManager from "react-native-incall-manager"
import type { WebRTCPlatform } from "../core/platform.js"

/**
 * React Native platform adapter, backed by `react-native-webrtc`.
 *
 * `react-native-webrtc` mirrors the browser WebRTC API, so {@link VoiceCall}'s
 * call logic runs unchanged — we only cast its classes to the DOM lib types the
 * core is written against. The shapes line up for the surface we use:
 * `createOffer` / `createAnswer`, `setLocal` / `setRemoteDescription`,
 * `addTrack`, `ontrack`, `createDataChannel`, and ICE trickle.
 */
export const nativePlatform: WebRTCPlatform = {
  isSupported() {
    return true
  },

  createPeerConnection(config) {
    return new RTCPeerConnection(config as object) as unknown as RTCPeerConnection
  },

  async getUserMedia(constraints) {
    return (await mediaDevices.getUserMedia(constraints as object)) as unknown as MediaStream
  },

  async queryMicrophonePermission() {
    // No silent pre-check on native — getUserMedia triggers the OS permission
    // prompt directly, and the core maps its rejection to mic_denied/mic_missing.
    return "unknown"
  },

  attachRemoteAudio() {
    // react-native-webrtc plays the remote AUDIO track through the device audio
    // session automatically, but the default route is the *earpiece* (quiet, like
    // a phone call). InCallManager owns the call audio session and routes to the
    // loudspeaker. Wrapped in try/catch so a missing/duplicate session never
    // crashes the call; the track still plays via the default route.
    const timers: ReturnType<typeof setTimeout>[] = []
    const forceSpeaker = (): void => {
      try {
        InCallManager.setForceSpeakerphoneOn(true)
      } catch {
        /* ignore */
      }
    }
    try {
      InCallManager.start({ media: "audio" })
      forceSpeaker()
      // react-native-webrtc sets up its own audio session a beat after connect
      // and resets the route to the earpiece, so re-assert the loudspeaker a few
      // times to win that race.
      timers.push(
        setTimeout(forceSpeaker, 400),
        setTimeout(forceSpeaker, 1200),
        setTimeout(forceSpeaker, 2500),
      )
    } catch {
      /* audio session unavailable — fall back to the default route */
    }
    return {
      detach() {
        timers.forEach(clearTimeout)
        try {
          InCallManager.setForceSpeakerphoneOn(false)
          InCallManager.stop()
        } catch {
          /* ignore */
        }
      },
    }
  },
}
