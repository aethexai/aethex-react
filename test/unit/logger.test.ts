import { describe, expect, it } from "vitest"
import { noopLogger } from "../../src/core/logger.js"

describe("noopLogger", () => {
  it("exposes silent debug/warn/error that accept a message and meta", () => {
    expect(() => {
      noopLogger.debug("d")
      noopLogger.warn("w", { code: 1 })
      noopLogger.error("e", { err: "boom" })
    }).not.toThrow()
  })
})
