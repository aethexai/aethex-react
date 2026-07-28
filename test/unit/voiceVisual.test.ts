import { describe, it, expect } from "vitest"
import { nameToFeatures, colorFromName } from "../../src/widgets/voiceVisual/features.js"
import { featuresToColor, hslToRgb, rgbToHex } from "../../src/widgets/voiceVisual/color.js"

describe("voice-visual / color", () => {
  it("featuresToColor is deterministic and in range", () => {
    const f = { pitch: 200, volumeDb: -20, rate: 4, bright: 2000 }
    const a = featuresToColor(f)
    const b = featuresToColor(f)
    expect(a).toEqual(b)
    expect(a.hue).toBeGreaterThanOrEqual(0)
    expect(a.hue).toBeLessThan(360)
    expect(a.sat).toBeGreaterThanOrEqual(0)
    expect(a.sat).toBeLessThanOrEqual(100)
    expect(a.light).toBeGreaterThanOrEqual(0)
    expect(a.rgb).toHaveLength(3)
    expect(a.hex).toMatch(/^#[0-9A-F]{6}$/)
    expect(a.css).toContain("rgb(")
    expect(a.norms.pitchN).toBeGreaterThanOrEqual(0)
  })

  it("handles extreme and fallback inputs without NaN", () => {
    // pitch:0 / bright:0 exercise the `|| default` fallbacks; both ends of each range.
    for (const f of [
      { pitch: 0, volumeDb: -42, rate: 2.2, bright: 0 },
      { pitch: 1000, volumeDb: 0, rate: 10, bright: 5000 },
    ]) {
      const c = featuresToColor(f)
      expect(Number.isNaN(c.hue)).toBe(false)
      expect(c.rgb.every((v) => v >= 0 && v <= 255)).toBe(true)
    }
  })

  it("hslToRgb covers grayscale + all hue sectors; rgbToHex clamps ends", () => {
    expect(hslToRgb(0, 0, 50)).toEqual([128, 128, 128]) // s===0 branch
    for (const h of [10, 80, 140, 200, 260, 330]) expect(hslToRgb(h, 70, 50)).toHaveLength(3)
    expect(rgbToHex([0, 0, 0])).toBe("#000000")
    expect(rgbToHex([255, 255, 255])).toBe("#FFFFFF")
  })
})

describe("voice-visual / features", () => {
  it("nameToFeatures is stable per name and varies across names", () => {
    expect(nameToFeatures({ name: "Kora" })).toEqual(nameToFeatures({ name: "Kora" }))
    expect(nameToFeatures({ name: "Kora" })).not.toEqual(nameToFeatures({ name: "Mary" }))
    expect(nameToFeatures({ name: "Kora" }).pitch).toBeGreaterThan(0)
  })

  it("colorFromName wires name+metadata → color", () => {
    const { features, color } = colorFromName({ name: "Kora", language: "en", country: "GH", gender: "f" })
    expect(features.rate).toBeGreaterThan(0)
    expect(color.hex).toMatch(/^#[0-9A-F]{6}$/)
    // metadata participates in the hash (homonym disambiguation) — still valid output.
    expect(colorFromName({ name: "Kora", language: "fr" }).color.hex).toMatch(/^#[0-9A-F]{6}$/)
  })
})
