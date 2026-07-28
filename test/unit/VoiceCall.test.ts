import { afterEach, describe, expect, it, vi } from "vitest"
import { VoiceCall } from "../../src/core/VoiceCall.js"
import { AethexError, isAethexError } from "../../src/core/errors.js"
import type { CallStatus } from "../../src/core/types.js"
import { installWebRTCMocks } from "../mocks/webrtc.js"

const BASE = "https://proxy.example.com"
const AGENT = "11111111-1111-1111-1111-111111111111"

function tick(ms = 80): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe("VoiceCall.start — critical ordering & contract", () => {
  it("acquires mic and addTrack BEFORE the data channel, offers with no legacy options", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })

    await call.start()

    const ops = recorder.ops
    const order = (name: string) => ops.indexOf(name)

    // session created first
    expect(order("connect")).toBeLessThan(order("getUserMedia"))
    // STEP A: tracks before STEP B: data channel
    expect(order("addTrack")).toBeLessThan(order("createDataChannel"))
    // STEP C: offer after the data channel, localDescription set, then POSTed
    expect(order("createDataChannel")).toBeLessThan(order("createOffer"))
    expect(order("createOffer")).toBeLessThan(order("setLocalDescription"))
    expect(order("setLocalDescription")).toBeLessThan(order("offer"))
    // STEP D: remote description applied last
    expect(order("offer")).toBeLessThan(order("setRemoteDescription"))

    // createOffer called with NO arguments (no offerToReceiveAudio/Video)
    expect(recorder.createOfferArgs).toHaveLength(0)

    // data channel is exactly "chat", ordered, client-created
    expect(recorder.lastDc?.label).toBe("chat")
    expect(recorder.lastDc?.options).toEqual({ ordered: true })
  })

  it("flushes ICE candidates BEFORE setRemoteDescription (pitfall #5)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({
      micPermission: "granted",
      emitIceOnSetLocal: true,
    })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()

    const ops = recorder.ops
    expect(ops.indexOf("ice")).toBeGreaterThan(-1)
    expect(ops.indexOf("ice")).toBeLessThan(ops.indexOf("setRemoteDescription"))
    // and it carried snake_case + the now-known pc_id
    expect(recorder.iceSent[0]?.pc_id).toBe("pc-1")
    expect(recorder.iceSent[0]?.candidates[0]).toEqual({
      candidate: "candidate:1 udp",
      sdp_mid: "0",
      sdp_mline_index: 0,
    })
  })

  it("trickles ICE eagerly with pc_id:null before the offer answer (Firefox fix)", async () => {
    // A candidate gathered during setLocalDescription must be flushed BEFORE the
    // offer answer brings pc_id — carrying pc_id:null so a buffering proxy parks
    // it and drains it upstream the moment pc_id is known. Holding it until pc_id
    // added a round-trip that pushed Firefox (TURN-only, symmetric NAT) past the
    // server's ICE/DTLS window and failed every candidate pair.
    const { recorder, fetchImpl } = installWebRTCMocks({
      micPermission: "granted",
      emitIceOnSetLocal: true,
      offerDelayMs: 120,
    })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()

    const earlyFlush = recorder.iceSent.find((b) => b.pc_id === null)
    expect(earlyFlush, "a candidate should flush before pc_id is known").toBeDefined()
    expect(earlyFlush?.candidates[0]).toEqual({
      candidate: "candidate:1 udp",
      sdp_mid: "0",
      sdp_mline_index: 0,
    })
    // the early flush happened before the offer answer was applied
    expect(recorder.ops.indexOf("ice")).toBeLessThan(recorder.ops.indexOf("setRemoteDescription"))
  })

  it("emits status idle → connecting → connected", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const seen: CallStatus[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      callbacks: { onStatusChange: (s) => seen.push(s) },
    })

    await call.start()
    expect(call.getStatus()).toBe("connecting")
    recorder.lastPc?.setState("connected")

    expect(seen).toEqual(["connecting", "connected"])
    expect(call.getStatus()).toBe("connected")
    expect(call.everConnected).toBe(true)
  })

  it("sends trickle ICE candidates in snake_case", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()

    recorder.lastPc?.emitIce({ candidate: "candidate:1 udp", sdpMid: "0", sdpMLineIndex: 0 })
    await tick()

    const last = recorder.iceSent.at(-1)
    expect(last?.pc_id).toBe("pc-1")
    expect(last?.candidates[0]).toEqual({
      candidate: "candidate:1 udp",
      sdp_mid: "0",
      sdp_mline_index: 0,
    })
  })

  it("requeues and retries ICE candidates when a flush fails (no candidate loss)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    let iceCalls = 0
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/ice")) {
        iceCalls++
        if (iceCalls === 1) {
          // First PATCH /ice fails transiently.
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: { get: () => null },
            json: async () => null,
          } as unknown as Response)
        }
      }
      return (fetchImpl as unknown as typeof fetch)(input, init)
    }) as unknown as typeof fetch

    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl: flaky })
    await call.start()

    recorder.lastPc?.emitIce({ candidate: "candidate:relay", sdpMid: "0", sdpMLineIndex: 0 })
    await tick(120) // first flush → 500 → requeue + schedule retry (ICE_RETRY_DELAY_MS)
    await tick(800) // retry fires and succeeds

    // the candidate was NOT dropped — it reached the server on retry
    const sent = recorder.iceSent.flatMap((b) => b.candidates as Array<{ candidate: string }>)
    expect(sent.some((c) => c.candidate === "candidate:relay")).toBe(true)
    expect(iceCalls).toBeGreaterThanOrEqual(2)
  })

  it("debounces multiple ICE candidates into batched flushes", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()

    // two candidates emitted back-to-back: the second hits the flushScheduled guard
    recorder.lastPc?.emitIce({ candidate: "a", sdpMid: "0", sdpMLineIndex: 0 })
    recorder.lastPc?.emitIce({ candidate: "b", sdpMid: "0", sdpMLineIndex: 0 })
    await tick()

    const allCandidates = recorder.iceSent.flatMap((b) => b.candidates)
    expect(allCandidates).toHaveLength(2)
  })

  it("exposes the remote stream via onRemoteStream", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    let got: MediaStream | null = null
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      callbacks: { onRemoteStream: (s) => (got = s) },
    })
    await call.start()

    const stream = { getTracks: () => [] } as unknown as MediaStream
    recorder.lastPc?.emitTrack(stream)
    expect(got).toBe(stream)
  })

  it("forwards pipeline-metrics from the chat data channel", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const metrics: unknown[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      callbacks: { onMetrics: (m) => metrics.push(m) },
    })
    await call.start()

    recorder.lastDc?.emit("message", { data: JSON.stringify({ type: "pipeline-metrics", turn_count: 2 }) })
    recorder.lastDc?.emit("message", { data: JSON.stringify({ type: "something-else" }) })

    expect(metrics).toEqual([{ type: "pipeline-metrics", turn_count: 2 }])
  })
})

describe("VoiceCall.stop — teardown", () => {
  it("detaches ALL PC handlers before close(), stops tracks, removes audio, is idempotent", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()
    // an <audio> element exists once a remote track arrives
    recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    expect(document.querySelector("audio")).not.toBeNull()
    const tracks = recorder.lastPc?.tracks as Array<{ stopped: boolean }> | undefined

    call.stop()
    call.stop() // idempotent — must not throw or double-close

    expect(recorder.handlersNullAtClose).toBe(true)
    expect(recorder.ops.filter((o) => o === "close")).toHaveLength(1)
    expect(tracks?.[0]?.stopped).toBe(true)
    expect(document.querySelector("audio")).toBeNull()
    expect(call.getStatus()).toBe("ended")
    await tick()
    expect(recorder.endCalled).toBe(true)
  })
})

describe("VoiceCall — remote close / peer failure release resources (no leak, no double callback)", () => {
  it("remote hang-up after connected: onClose ONCE, tracks stopped, audio gone, notify-ended sent", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    let closeCount = 0
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      callbacks: { onClose: () => closeCount++ },
    })
    await call.start()
    recorder.lastPc?.setState("connected")
    recorder.lastPc?.emitTrack({ getTracks: () => [] } as unknown as MediaStream)
    const tracks = recorder.lastPc?.tracks as Array<{ stopped: boolean }> | undefined

    // remote closes the peer connection; the data channel then also closes
    recorder.lastPc?.setState("closed")
    recorder.lastDc?.close()

    expect(closeCount).toBe(1) // not double-fired via the dc close listener
    expect(call.getStatus()).toBe("ended")
    expect(tracks?.[0]?.stopped).toBe(true)
    expect(document.querySelector("audio")).toBeNull()
    await tick()
    expect(recorder.endCalled).toBe(true)
  })

  it("peer 'failed' releases resources and fires onError once with peer_failed (iceRestart off)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const errors: string[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      iceRestart: false,
      callbacks: { onError: (e) => errors.push(e.code) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")
    const tracks = recorder.lastPc?.tracks as Array<{ stopped: boolean }> | undefined

    recorder.lastPc?.setState("failed")
    recorder.lastPc?.setState("closed") // must not produce a second callback

    expect(errors).toEqual(["peer_failed"])
    expect(call.getStatus()).toBe("error")
    expect(tracks?.[0]?.stopped).toBe(true)
  })
})

describe("VoiceCall — error taxonomy", () => {
  it("throws synchronously when apiBaseUrl looks like an API key", () => {
    expect(() => new VoiceCall({ agentId: AGENT, apiBaseUrl: "https://api/ae_live_secret" })).toThrow(
      AethexError,
    )
  })

  it("maps a denied microphone to a non-recoverable mic_denied error", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "denied" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })

    await expect(call.start()).rejects.toMatchObject({ code: "mic_denied", recoverable: false })
    expect(call.getStatus()).toBe("error")
  })

  it("maps getUserMedia NotFoundError to mic_missing", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted", getUserMediaError: "NotFoundError" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await expect(call.start()).rejects.toMatchObject({ code: "mic_missing" })
  })

  it("maps a zero-track getUserMedia result to mic_missing", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted", noAudioTracks: true })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await expect(call.start()).rejects.toMatchObject({ code: "mic_missing" })
  })

  it("does NOT leak the microphone when signaling fails after getUserMedia (503 on offer)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({
      micPermission: "granted",
      offer: { ok: false, status: 503 },
    })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await expect(call.start()).rejects.toMatchObject({ code: "capacity" })

    const tracks = recorder.lastPc?.tracks as Array<{ stopped: boolean }> | undefined
    expect(tracks?.[0]?.stopped).toBe(true) // mic released on failure
    expect(recorder.handlersNullAtClose).toBe(true)
  })

  it("maps a 429 connect to quota_exceeded with Retry-After", async () => {
    const { fetchImpl } = installWebRTCMocks({
      micPermission: "granted",
      connect: { ok: false, status: 429, retryAfter: "30" },
    })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })

    try {
      await call.start()
      expect.unreachable("start should reject")
    } catch (err) {
      expect(isAethexError(err)).toBe(true)
      expect((err as AethexError).code).toBe("quota_exceeded")
      expect((err as AethexError).retryAfter).toBe(30)
      expect((err as AethexError).recoverable).toBe(true)
    }
  })

  it("maps a 503 offer to capacity", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted", offer: { ok: false, status: 503 } })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await expect(call.start()).rejects.toMatchObject({ code: "capacity", recoverable: true })
  })

  it("rejects with unsupported_browser when WebRTC APIs are absent", async () => {
    // No mocks installed → no RTCPeerConnection, no navigator.mediaDevices.
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    await expect(call.start()).rejects.toMatchObject({ code: "unsupported_browser" })
  })

  it("rejects when start() is called twice without teardown", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()
    await expect(call.start()).rejects.toMatchObject({ code: "connect_failed" })
  })
})

describe("VoiceCall — data channel + peer-state passthrough", () => {
  it("interrupt() and send() write to the open chat channel; closed channel is a no-op", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()

    call.interrupt()
    call.send({ type: "noop" })
    expect(recorder.ops.filter((o) => o === "dc.send")).toHaveLength(2)

    recorder.lastDc!.readyState = "closed"
    call.send({ type: "noop" }) // must not throw or send
    expect(recorder.ops.filter((o) => o === "dc.send")).toHaveLength(2)
  })

  it("getRemoteStatus fetches the server-side session status", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()

    const status = await call.getRemoteStatus()
    expect(status).toMatchObject({ session_id: "sess-1", status: "active", turn_count: 3 })
    call.stop()
  })

  it("getRemoteStatus still resolves AFTER stop() — it is not tied to the call's abort signal", async () => {
    const { fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const call = new VoiceCall({ agentId: AGENT, apiBaseUrl: BASE, fetchImpl })
    await call.start()
    call.stop() // stop() aborts the call's internal controller

    // Fetching the completed session's status must NOT reject with "aborted".
    const status = await call.getRemoteStatus()
    expect(status).toMatchObject({ session_id: "sess-1" })
  })

  it("forwards raw RTCPeerConnection state and ignores non-string data-channel messages", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const states: string[] = []
    const metrics: unknown[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      callbacks: { onPeerStateChange: (s) => states.push(s), onMetrics: (m) => metrics.push(m) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")
    recorder.lastDc?.emit("message", { data: { not: "a string" } }) // ignored

    expect(states).toContain("connected")
    expect(metrics).toEqual([])
    call.stop()
  })
})

describe("VoiceCall — ICE restart (on by default)", () => {
  it("renegotiates with restart_pc:true on 'failed' instead of failing (default behaviour)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const offers: Array<Record<string, unknown>> = []
    const capturing = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/offer") && (init?.method ?? "GET") === "POST") {
        offers.push(JSON.parse(String(init?.body)))
      }
      return (fetchImpl as unknown as typeof fetch)(input, init)
    }) as unknown as typeof fetch

    const errors: string[] = []
    // no iceRestart flag → uses the default (enabled)
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl: capturing,
      callbacks: { onError: (e) => errors.push(e.code) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")

    recorder.lastPc?.setState("failed")
    await tick(120) // let the async restart run

    // a SECOND offer went out, carrying the ICE-restart flag + existing pc_id
    expect(offers).toHaveLength(2)
    expect(offers[1]).toMatchObject({ restart_pc: true, pc_id: "pc-1" })
    // createOffer was asked for an ICE restart
    expect(recorder.createOfferArgs).toEqual([{ iceRestart: true }])
    // no error surfaced — the call recovered rather than failing
    expect(errors).toEqual([])
    expect(call.getStatus()).not.toBe("error")
    call.stop()
  })

  it("gives up with peer_failed once maxIceRestarts is exhausted", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const errors: string[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      maxIceRestarts: 1,
      callbacks: { onError: (e) => errors.push(e.code) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")

    recorder.lastPc?.setState("failed") // attempt 1 → restart
    await tick(120)
    recorder.lastPc?.setState("failed") // attempt budget spent → fail
    await tick(120)

    expect(errors).toEqual(["peer_failed"])
    expect(call.getStatus()).toBe("error")
  })

  it("fails immediately on 'failed' when iceRestart is explicitly disabled", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const errors: string[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      iceRestart: false,
      callbacks: { onError: (e) => errors.push(e.code) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")
    recorder.lastPc?.setState("failed")
    await tick()

    expect(errors).toEqual(["peer_failed"])
  })

  it("resets the restart budget after a clean reconnect (maxIceRestarts is consecutive, not lifetime)", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const restartOffers: Array<Record<string, unknown>> = []
    const capturing = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/offer") && (init?.method ?? "GET") === "POST") {
        const body = JSON.parse(String(init?.body))
        if (body.restart_pc === true) restartOffers.push(body)
      }
      return (fetchImpl as unknown as typeof fetch)(input, init)
    }) as unknown as typeof fetch

    const errors: string[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl: capturing,
      maxIceRestarts: 1,
      callbacks: { onError: (e) => errors.push(e.code) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")

    recorder.lastPc?.setState("failed") // restart #1
    await tick(120)
    recorder.lastPc?.setState("connected") // clean recovery → budget resets to 0
    recorder.lastPc?.setState("failed") // restart #2 — would be blocked without the reset
    await tick(120)

    // both drops were recovered by a restart; no lifetime cap kicked in
    expect(restartOffers).toHaveLength(2)
    expect(errors).toEqual([])
    call.stop()
  })
})

describe("VoiceCall — disconnected grace timer", () => {
  afterEach(() => vi.useRealTimers())

  it("after connected: a sustained 'disconnected' ends gracefully (onClose) when iceRestart is off", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    let closed = 0
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      iceRestart: false,
      callbacks: { onClose: () => closed++ },
    })
    await call.start()
    recorder.lastPc?.setState("connected")

    vi.useFakeTimers()
    recorder.lastPc?.setState("disconnected")
    vi.advanceTimersByTime(6000)

    expect(closed).toBe(1)
    expect(call.getStatus()).toBe("ended")
  })

  it("with ICE restart ON (default), a sustained 'disconnected' still ends gracefully — restart is failed-only", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    let closed = 0
    const errors: string[] = []
    const offers: unknown[] = []
    const capturing = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/offer") && (init?.method ?? "GET") === "POST") offers.push(1)
      return (fetchImpl as unknown as typeof fetch)(input, init)
    }) as unknown as typeof fetch
    // no iceRestart flag → default enabled
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl: capturing,
      callbacks: { onClose: () => closed++, onError: (e) => errors.push(e.code) },
    })
    await call.start()
    recorder.lastPc?.setState("connected")

    vi.useFakeTimers()
    recorder.lastPc?.setState("disconnected")
    vi.advanceTimersByTime(6000)

    // graceful end, no error, and NO renegotiation offer beyond the initial one
    expect(closed).toBe(1)
    expect(errors).toEqual([])
    expect(offers).toHaveLength(1) // only the initial start() offer
    expect(call.getStatus()).toBe("ended")
  })

  it("before ever connecting: a sustained 'disconnected' fails with peer_failed", async () => {
    const { recorder, fetchImpl } = installWebRTCMocks({ micPermission: "granted" })
    const errors: string[] = []
    const call = new VoiceCall({
      agentId: AGENT,
      apiBaseUrl: BASE,
      fetchImpl,
      callbacks: { onError: (e) => errors.push(e.code) },
    })
    await call.start()

    vi.useFakeTimers()
    recorder.lastPc?.setState("disconnected")
    vi.advanceTimersByTime(6000)

    expect(errors).toEqual(["peer_failed"])
  })
})
