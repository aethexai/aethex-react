import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useAudioLevel } from "../../src/react/useAudioLevel.js"

const originals = {
  AudioContext: (globalThis as { AudioContext?: unknown }).AudioContext,
  raf: globalThis.requestAnimationFrame,
  caf: globalThis.cancelAnimationFrame,
}

afterEach(() => {
  ;(globalThis as { AudioContext?: unknown }).AudioContext = originals.AudioContext
  globalThis.requestAnimationFrame = originals.raf
  globalThis.cancelAnimationFrame = originals.caf
  vi.restoreAllMocks()
})

describe("useAudioLevel", () => {
  it("returns zeros for a null stream", () => {
    const { result } = renderHook(() => useAudioLevel(null, 5))
    expect(result.current.level).toBe(0)
    expect(result.current.bars).toEqual([0, 0, 0, 0, 0])
  })

  it("degrades to zeros when Web Audio is unavailable", () => {
    ;(globalThis as { AudioContext?: unknown }).AudioContext = undefined
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = undefined
    const stream = { id: "s" } as unknown as MediaStream
    const { result } = renderHook(() => useAudioLevel(stream, 3))
    expect(result.current.level).toBe(0)
    expect(result.current.bars).toEqual([0, 0, 0])
  })

  it("measures levels from a stream and cleans up on unmount", () => {
    const close = vi.fn(async () => {})
    const disconnect = vi.fn()
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 16,
      getByteFrequencyData: (arr: Uint8Array) => arr.fill(200),
      connect: vi.fn(),
      disconnect,
    }
    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect }
      }
      createAnalyser() {
        return analyser
      }
      resume = vi.fn(async () => {})
      close = close
    }
    ;(globalThis as { AudioContext?: unknown }).AudioContext =
      FakeAudioContext as unknown as typeof AudioContext

    // Bounded rAF: invoke the callback exactly once, then stop rescheduling.
    let fired = 0
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      if (fired++ === 0) cb(0)
      return fired
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame

    const stream = { id: "s" } as unknown as MediaStream
    const { result, unmount } = renderHook(() => useAudioLevel(stream, 4))

    // One tick ran with a full-scale buffer → level and bars should be > 0.
    expect(result.current.level).toBeGreaterThan(0)
    expect(result.current.bars.some((b) => b > 0)).toBe(true)

    act(() => unmount())
    expect(close).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalled()
  })
})
