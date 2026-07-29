import { StrictMode } from "react"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useAethexCall, type UseAethexCallOptions } from "../../src/react/useAethexCall.js"
import { installWebRTCMocks, type MockRecorder } from "../mocks/webrtc.js"

const BASE = "https://proxy.example.com"
const AGENT = "11111111-1111-1111-1111-111111111111"

function tick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe("useAethexCall", () => {
  it("starts idle and exposes stable callbacks", () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result, rerender } = renderHook(() =>
      useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }),
    )
    expect(result.current.status).toBe("idle")
    expect(result.current.isConnecting).toBe(false)
    expect(result.current.isConnected).toBe(false)

    const firstStart = result.current.start
    rerender()
    expect(result.current.start).toBe(firstStart) // stable identity across renders
  })

  it("transitions idle → connecting → connected and fires onConnected", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const onConnected = vi.fn()
    const { result } = renderHook(() =>
      useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl, onConnected }),
    )

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe("connecting")

    act(() => {
      ;(recorder as MockRecorder).lastPc?.setState("connected")
    })
    expect(result.current.status).toBe("connected")
    expect(result.current.isConnected).toBe(true)
    expect(result.current.sessionId).toBe("sess-1")
    expect(onConnected).toHaveBeenCalledOnce()
  })

  it("exposes the remote stream", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result } = renderHook(() => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }))
    await act(async () => {
      await result.current.start()
    })
    const stream = { getTracks: () => [] } as unknown as MediaStream
    act(() => {
      recorder.lastPc?.emitTrack(stream)
    })
    expect(result.current.remoteStream).toBe(stream)
  })

  it("surfaces errors via state + onError, never throwing from start()", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "denied" })
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl, onError }),
    )

    await act(async () => {
      await expect(result.current.start()).resolves.toBeUndefined()
    })
    expect(result.current.status).toBe("error")
    expect(result.current.error?.code).toBe("mic_denied")
    expect(onError).toHaveBeenCalledOnce()
  })

  it("stop() ends the call and fires onEnded", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const onEnded = vi.fn()
    const { result } = renderHook(() =>
      useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl, onEnded }),
    )
    await act(async () => {
      await result.current.start()
    })
    act(() => {
      recorder.lastPc?.setState("connected")
      result.current.stop()
    })
    expect(result.current.status).toBe("ended")
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it("forwards optional config (endpoints/timeout/headers/audioConstraints/logger) to the call", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { result } = renderHook(() =>
      useAethexCall({
        agentId: AGENT,
        apiBaseUrl: BASE,
        fetchImpl,
        endpoints: { connect: "sessions" },
        timeoutMs: 5000,
        headers: { "X-Token": "abc" },
        audioConstraints: { echoCancellation: true },
        logger,
      }),
    )
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe("connecting")
  })

  it("interrupt() forwards to the active call", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result } = renderHook(() => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }))
    await act(async () => {
      await result.current.start()
    })
    act(() => result.current.interrupt())
    expect(recorder.ops.filter((o) => o === "dc.send")).toHaveLength(1)
  })

  it("tears the call down on unmount (no leak)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result, unmount } = renderHook(() =>
      useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }),
    )
    await act(async () => {
      await result.current.start()
    })
    unmount()
    await tick()
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
    expect(recorder.endCalled).toBe(true)
  })

  it("is StrictMode-safe: one teardown, no double-close", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result, unmount } = renderHook(
      () => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }),
      { wrapper: StrictMode },
    )
    await act(async () => {
      await result.current.start()
    })
    act(() => {
      recorder.lastPc?.setState("connected")
    })
    unmount()
    await tick()
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
  })

  it("restart during an active call does NOT fire a spurious onEnded", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const onEnded = vi.fn()
    const { result } = renderHook(() =>
      useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl, onEnded }),
    )
    await act(async () => {
      await result.current.start()
    })
    act(() => {
      recorder.lastPc?.setState("connected")
    })
    // restart while connected
    await act(async () => {
      await result.current.start()
    })
    expect(onEnded).not.toHaveBeenCalled() // previous instance's "ended" is suppressed
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1) // old call torn down
    expect(result.current.status).toBe("connecting") // fresh call connecting
  })

  it("reads the latest callbacks (no stale closure) after a rerender", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook((props: UseAethexCallOptions) => useAethexCall(props), {
      initialProps: { agentId: AGENT, apiBaseUrl: BASE, fetchImpl, onConnected: first },
    })
    await act(async () => {
      await result.current.start()
    })
    // swap the callback AFTER start; the connected event must hit the new one
    rerender({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl, onConnected: second })
    act(() => {
      recorder.lastPc?.setState("connected")
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it("setMuted/toggleMute reflect state and forward to the active call", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result } = renderHook(() => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }))
    await act(async () => {
      await result.current.start()
    })
    const track = (recorder.lastPc?.tracks as Array<{ enabled?: boolean }>)[0]!

    act(() => result.current.setMuted(true))
    expect(result.current.isMuted).toBe(true)
    expect(track.enabled).toBe(false)

    let next!: boolean
    act(() => {
      next = result.current.toggleMute()
    })
    expect(next).toBe(false)
    expect(result.current.isMuted).toBe(false)
    expect(track.enabled).toBe(true)
  })

  it("setOutputVolume clamps, reflects in state, and persists across a restart", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result } = renderHook(() => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }))
    await act(async () => {
      await result.current.start()
    })

    act(() => result.current.setOutputVolume(2)) // clamps to 1
    expect(result.current.volume).toBe(1)
    act(() => result.current.setOutputVolume(0.4))
    expect(result.current.volume).toBeCloseTo(0.4)

    // Restart — the volume preference carries into the fresh call.
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.volume).toBeCloseTo(0.4)
  })

  it("submitFeedback forwards to the active call and rejects when there is none", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const { result } = renderHook(() => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }))

    await expect(result.current.submitFeedback(5)).rejects.toMatchObject({ code: "connect_failed" })

    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      await result.current.submitFeedback(5, "great")
    })
    expect(recorder.feedback).toEqual({ rating: 5, comment: "great" })
  })

  it("derives isSpeaking from the agent output level while connected", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })

    // Controllable rAF (capture + flush) and clock so the hangover is testable.
    let rafCb: FrameRequestCallback | null = null
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {})
    let now = 1000
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const flush = (): void => {
      const cb = rafCb
      rafCb = null
      cb?.(now)
    }

    let sampleFill = 200 // 200 → loud, 128 → silent
    class FakeAudioContext {
      createAnalyser() {
        return {
          fftSize: 0,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (arr: Uint8Array) => arr.fill(sampleFill),
        }
      }
      createMediaStreamSource() {
        return { connect: () => {} }
      }
      close() {}
    }
    const g = globalThis as unknown as { AudioContext?: unknown }
    const prevAC = g.AudioContext
    g.AudioContext = FakeAudioContext

    try {
      const { result } = renderHook(() => useAethexCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl }))
      await act(async () => {
        await result.current.start()
      })
      act(() => {
        recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
        recorder.lastPc?.setState("connected") // starts the polling loop
      })

      act(() => flush()) // loud sample → speaking
      expect(result.current.isSpeaking).toBe(true)

      sampleFill = 128 // silence
      now = 2000 // past the hangover window
      act(() => flush())
      expect(result.current.isSpeaking).toBe(false)

      act(() => result.current.stop())
    } finally {
      if (prevAC === undefined) delete g.AudioContext
      else g.AudioContext = prevAC
    }
  })
})
