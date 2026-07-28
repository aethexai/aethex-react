// @vitest-environment node
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { useAethexCall } from "../../src/react/useAethexCall.js"
import { useAudioLevel } from "../../src/react/useAudioLevel.js"

// Runs in a Node environment with NO window/document/navigator/RTCPeerConnection
// — proves the hooks are import- and render-safe on the server (effects don't
// run during SSR, so no browser API is touched).

function CallProbe() {
  const { status, isConnected } = useAethexCall({ agentId: "a", apiBaseUrl: "https://proxy" })
  return createElement("span", null, `${status}:${String(isConnected)}`)
}

function LevelProbe() {
  const { level, bars } = useAudioLevel(null, 3)
  return createElement("span", null, `${level}:${bars.join(",")}`)
}

describe("SSR (node environment)", () => {
  it("renders useAethexCall on the server without touching browser APIs", () => {
    expect(typeof window).toBe("undefined")
    const html = renderToStaticMarkup(createElement(CallProbe))
    expect(html).toBe("<span>idle:false</span>")
  })

  it("renders useAudioLevel on the server", () => {
    const html = renderToStaticMarkup(createElement(LevelProbe))
    expect(html).toBe("<span>0:0,0,0</span>")
  })
})
