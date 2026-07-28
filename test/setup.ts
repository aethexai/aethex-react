// Vitest global setup. jsdom provides DOMException, AbortController, document.
// WebRTC + getUserMedia are NOT implemented by jsdom — tests install fakes
// from ./mocks/webrtc and uninstall them in afterEach.
import { afterEach } from "vitest"
import { uninstallWebRTCMocks } from "./mocks/webrtc.js"

// jest-dom matchers (toBeInTheDocument, toHaveAttribute, …) for widget tests.
// Only meaningful in a DOM environment; skip under the node (SSR) environment.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest")
}

// jsdom doesn't implement HTMLMediaElement.play and logs a noisy
// "Not implemented" error. The SDK guards the call, so stub it to stay quiet.
// Guarded so node-environment (SSR) test files can share this setup file.
if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = () => Promise.resolve()
}

// jsdom doesn't implement canvas 2D either; it logs "Not implemented" and the
// orb widget guards a null context. Stub getContext to return null quietly.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
}

afterEach(() => {
  uninstallWebRTCMocks()
  // jsdom shares one document across a file; clear any <audio> left by tests
  // that intentionally skip teardown so DOM assertions stay isolated.
  if (typeof document !== "undefined") document.body.innerHTML = ""
})
