import { describe, expect, it } from "vitest"
import { AethexError, fromMediaError, isAethexError } from "../../src/core/errors.js"

describe("AethexError", () => {
  it("carries code, recoverable, retryAfter, status and is instanceof Error", () => {
    const e = new AethexError("quota_exceeded", "slow down", {
      recoverable: true,
      retryAfter: 60,
      status: 429,
    })
    expect(e).toBeInstanceOf(Error)
    expect(isAethexError(e)).toBe(true)
    expect(e.code).toBe("quota_exceeded")
    expect(e.recoverable).toBe(true)
    expect(e.retryAfter).toBe(60)
    expect(e.status).toBe(429)
  })

  it("defaults recoverable to false and isAethexError rejects non-errors", () => {
    expect(new AethexError("unknown", "x").recoverable).toBe(false)
    expect(isAethexError(new Error("x"))).toBe(false)
    expect(isAethexError(null)).toBe(false)
  })
})

describe("fromMediaError", () => {
  it("maps NotAllowedError / SecurityError → mic_denied", () => {
    expect(fromMediaError({ name: "NotAllowedError" }).code).toBe("mic_denied")
    expect(fromMediaError({ name: "SecurityError" }).code).toBe("mic_denied")
  })

  it("maps NotFoundError / OverconstrainedError → mic_missing", () => {
    expect(fromMediaError({ name: "NotFoundError" }).code).toBe("mic_missing")
    expect(fromMediaError({ name: "OverconstrainedError" }).code).toBe("mic_missing")
  })

  it("maps anything else → mic_denied (non-recoverable)", () => {
    const e = fromMediaError(new Error("weird"))
    expect(e.code).toBe("mic_denied")
    expect(e.recoverable).toBe(false)
  })
})
