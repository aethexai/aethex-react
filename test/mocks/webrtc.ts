/**
 * Minimal WebRTC + media + fetch fakes for unit-testing VoiceCall in jsdom.
 * Records the operation order so tests can assert the load-bearing sequence
 * (tracks → data channel → offer → setLocalDescription → ICE → setRemote).
 */
import { vi } from "vitest"

export interface MockRecorder {
  ops: string[]
  createOfferArgs: unknown[]
  iceSent: Array<{ pc_id: string | null; candidates: unknown[] }>
  requests: Array<{ url: string; method: string; headers: Record<string, string> }>
  feedback: { rating?: number; comment?: string } | null
  endCalled: boolean
  handlersNullAtClose: boolean | null
  lastPc: FakePeerConnection | null
  lastDc: FakeDataChannel | null
}

export interface MockOptions {
  /** Permissions API state for "microphone". Omit to leave permissions absent. */
  micPermission?: PermissionState
  /** Make getUserMedia reject with a DOMException of this name. */
  getUserMediaError?: string
  /** Make getUserMedia resolve with zero audio tracks. */
  noAudioTracks?: boolean
  /** Override the connect (POST /sessions) HTTP response. */
  connect?: { ok: boolean; status?: number; retryAfter?: string }
  /** Override the offer (POST /offer) HTTP response. */
  offer?: { ok: boolean; status?: number }
  /** Emit one ICE candidate during setLocalDescription (mimics a real PC gathering). */
  emitIceOnSetLocal?: boolean
  /** Delay the offer (POST /offer) response by N ms, so candidates gathered
   *  during setLocalDescription flush BEFORE pc_id is known (eager trickle). */
  offerDelayMs?: number
}

let recorder: MockRecorder
let currentOpts: MockOptions = {}
let installed = false

export function getRecorder(): MockRecorder {
  return recorder
}

class FakeTrack {
  kind = "audio"
  stopped = false
  stop(): void {
    this.stopped = true
  }
}

function fakeStream(noAudio = false): MediaStream {
  const tracks = noAudio ? [] : [new FakeTrack()]
  return {
    getAudioTracks: () => tracks as unknown as MediaStreamTrack[],
    getTracks: () => tracks as unknown as MediaStreamTrack[],
  } as unknown as MediaStream
}

export class FakeDataChannel {
  readyState: RTCDataChannelState = "open"
  private listeners: Record<string, Array<(ev: unknown) => void>> = {}
  constructor(
    public label: string,
    public options: unknown,
  ) {}
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(cb)
  }
  send(data: string): void {
    recorder.ops.push("dc.send")
    void data
  }
  close(): void {
    this.readyState = "closed"
    this.emit("close", {})
  }
  emit(type: string, ev: unknown): void {
    this.listeners[type]?.forEach((cb) => cb(ev))
  }
}

export class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new"
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((ev: RTCTrackEvent) => void) | null = null
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null
  localDescription: unknown = null
  remoteDescription: unknown = null
  tracks: unknown[] = []
  closed = false

  constructor(public config: RTCConfiguration) {
    recorder.lastPc = this
  }
  addTrack(track: unknown): void {
    recorder.ops.push("addTrack")
    this.tracks.push(track)
  }
  createDataChannel(label: string, options: unknown): FakeDataChannel {
    recorder.ops.push("createDataChannel")
    const dc = new FakeDataChannel(label, options)
    recorder.lastDc = dc
    return dc
  }
  async createOffer(...args: unknown[]): Promise<RTCSessionDescriptionInit> {
    recorder.ops.push("createOffer")
    recorder.createOfferArgs = args
    return { sdp: "v=0\r\noffer", type: "offer" }
  }
  async setLocalDescription(desc: unknown): Promise<void> {
    recorder.ops.push("setLocalDescription")
    this.localDescription = desc
    if (currentOpts.emitIceOnSetLocal) {
      // Real peers begin gathering here; surface one candidate synchronously so
      // the eager STEP-D flush sends it before setRemoteDescription.
      this.emitIce({ candidate: "candidate:1 udp", sdpMid: "0", sdpMLineIndex: 0 })
    }
  }
  async setRemoteDescription(desc: unknown): Promise<void> {
    recorder.ops.push("setRemoteDescription")
    this.remoteDescription = desc
  }
  close(): void {
    recorder.ops.push("close")
    recorder.handlersNullAtClose = this.onconnectionstatechange === null
    this.closed = true
    this.connectionState = "closed"
  }

  // ── test drivers ──
  emitIce(candidate: Partial<RTCIceCandidate> | null): void {
    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent)
  }
  emitTrack(stream: MediaStream): void {
    this.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent)
  }
  setState(state: RTCPeerConnectionState): void {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

function makeResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number; retryAfter?: string | undefined },
) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: (h: string) => (h === "Retry-After" ? (init?.retryAfter ?? null) : null) },
    json: async () => body,
  } as unknown as Response
}

export function installWebRTCMocks(opts: MockOptions = {}): {
  recorder: MockRecorder
  fetchImpl: typeof fetch
} {
  installed = true
  currentOpts = opts
  recorder = {
    ops: [],
    createOfferArgs: [],
    iceSent: [],
    requests: [],
    feedback: null,
    endCalled: false,
    handlersNullAtClose: null,
    lastPc: null,
    lastDc: null,
  }

  ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePeerConnection

  const mediaDevices = {
    getUserMedia: vi.fn(async () => {
      recorder.ops.push("getUserMedia")
      if (opts.getUserMediaError) {
        const err = new DOMException("denied", opts.getUserMediaError)
        throw err
      }
      return fakeStream(opts.noAudioTracks)
    }),
  }
  const permissions = opts.micPermission
    ? { query: vi.fn(async () => ({ state: opts.micPermission })) }
    : undefined

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: mediaDevices,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis.navigator, "permissions", {
    value: permissions,
    configurable: true,
    writable: true,
  })

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    recorder.requests.push({ url, method, headers: (init?.headers as Record<string, string>) ?? {} })
    if ((url.endsWith("/sessions") || url.endsWith("/conversation/connect")) && method === "POST") {
      recorder.ops.push("connect")
      if (opts.connect && !opts.connect.ok) {
        return makeResponse(null, {
          ok: false,
          status: opts.connect.status ?? 500,
          retryAfter: opts.connect.retryAfter,
        })
      }
      return makeResponse({ session_id: "sess-1", ice_config: { iceServers: [] } })
    }
    if (url.includes("/offer")) {
      recorder.ops.push("offer")
      if (opts.offer && !opts.offer.ok) {
        return makeResponse(null, { ok: false, status: opts.offer.status ?? 500 })
      }
      if (opts.offerDelayMs) {
        await new Promise((r) => setTimeout(r, opts.offerDelayMs))
      }
      return makeResponse({ sdp: "v=0\r\nanswer", type: "answer", pc_id: "pc-1" })
    }
    if (url.includes("/ice")) {
      recorder.ops.push("ice")
      recorder.iceSent.push(JSON.parse(String(init?.body)))
      return makeResponse(null)
    }
    if (url.includes("/status") && method === "GET") {
      recorder.ops.push("status")
      return makeResponse({ session_id: "sess-1", status: "active", duration_s: 12, turn_count: 3 })
    }
    if (url.includes("/feedback") && method === "POST") {
      recorder.ops.push("feedback")
      recorder.feedback = JSON.parse(String(init?.body))
      return makeResponse({ ok: true })
    }
    if (url.includes("notify-ended") || url.endsWith("/end")) {
      recorder.endCalled = true
      return makeResponse(null)
    }
    return makeResponse(null, { ok: false, status: 404 })
  }) as unknown as typeof fetch

  return { recorder, fetchImpl }
}

export function uninstallWebRTCMocks(): void {
  if (!installed) return
  installed = false
  currentOpts = {}
  delete (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection
  vi.restoreAllMocks()
}
