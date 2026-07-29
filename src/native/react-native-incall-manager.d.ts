// Minimal ambient types for the optional peer dependency
// `react-native-incall-manager`, so the SDK type-checks and builds without the
// native module installed. The React Native app provides the real one; on web it
// is never imported (the native entry is only resolved under Metro).
declare module "react-native-incall-manager" {
  interface InCallManager {
    start(opts?: { media?: "audio" | "video"; auto?: boolean; ringback?: string }): void
    stop(opts?: { busytone?: string }): void
    setForceSpeakerphoneOn(flag?: boolean | null): void
  }
  const InCallManager: InCallManager
  export default InCallManager
}
