// Minimal ambient declaration for the OPTIONAL peer dependency
// `react-native-webrtc`, so this package type-checks and builds without the
// native module installed. At runtime the consumer's own `react-native-webrtc`
// install provides the real implementation (its classes mirror the browser
// WebRTC API, which is why the core call logic is reused unchanged).
declare module "react-native-webrtc" {
  export const RTCPeerConnection: { new (configuration?: object): unknown }
  export const mediaDevices: { getUserMedia(constraints: object): Promise<unknown> }
}
