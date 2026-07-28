import { AethexError } from "./errors.js"
import type {
  AethexCallConfig,
  AethexEndpoints,
  ConnectResponse,
  IceCandidatePayload,
  OfferResponse,
  SessionStatusResponse,
} from "./types.js"

const DEFAULT_ENDPOINTS: AethexEndpoints = {
  connect: "sessions",
  offer: "sessions/:id/offer",
  ice: "sessions/:id/ice",
  end: "sessions/:id/notify-ended",
  status: "sessions/:id/status",
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * REST signaling client. Owns timeouts, abort wiring, and HTTP→AethexError
 * mapping so VoiceCall stays focused on the WebRTC dance.
 */
export class Transport {
  private readonly base: string
  private readonly endpoints: AethexEndpoints
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly headers: Record<string, string>

  constructor(config: AethexCallConfig) {
    this.base = config.apiBaseUrl.replace(/\/$/, "")
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...config.endpoints }
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const globalFetch = typeof fetch !== "undefined" ? fetch : undefined
    const impl = config.fetchImpl ?? globalFetch
    if (!impl) {
      throw new AethexError("network", "No fetch implementation is available.")
    }
    // Bind to avoid "Illegal invocation" when fetch is the global.
    this.fetchImpl = impl.bind(globalThis)
    this.headers = { "Content-Type": "application/json", ...config.headers }
  }

  /** POST /sessions { agent_id } → { session_id, ice_config }. */
  async connect(agentId: string, signal: AbortSignal): Promise<ConnectResponse> {
    const res = await this.request(this.url("connect"), {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
      signal,
    })
    if (!res.ok) throw this.mapConnectError(res)
    return (await res.json()) as ConnectResponse
  }

  /**
   * POST /sessions/:id/offer → answer SDP. Pass `{ pcId, restartPc: true }` to
   * renegotiate an existing peer connection for an ICE restart.
   */
  async sendOffer(
    sessionId: string,
    offer: { sdp: string | undefined; type: string },
    signal: AbortSignal,
    opts?: { pcId?: string | null; restartPc?: boolean },
  ): Promise<OfferResponse> {
    const res = await this.request(this.url("offer", sessionId), {
      method: "POST",
      body: JSON.stringify({
        sdp: offer.sdp,
        type: offer.type,
        pc_id: opts?.pcId ?? null,
        restart_pc: opts?.restartPc ?? false,
      }),
      signal,
    })
    if (!res.ok) throw this.mapOfferError(res)
    return (await res.json()) as OfferResponse
  }

  /** GET /sessions/:id/status → the server-side session status. */
  async getStatus(sessionId: string, signal: AbortSignal): Promise<SessionStatusResponse> {
    const res = await this.request(this.url("status", sessionId), { method: "GET", signal })
    if (!res.ok) {
      throw new AethexError("network", `Failed to fetch session status (${res.status}).`, {
        status: res.status,
        recoverable: res.status >= 500,
      })
    }
    return (await res.json()) as SessionStatusResponse
  }

  /** PATCH /sessions/:id/ice — trickle candidates (exempt from quota). */
  async sendIce(
    sessionId: string,
    pcId: string | null,
    candidates: IceCandidatePayload[],
    signal: AbortSignal,
  ): Promise<void> {
    const res = await this.request(this.url("ice", sessionId), {
      method: "PATCH",
      body: JSON.stringify({ pc_id: pcId, candidates }),
      signal,
    })
    if (!res.ok) {
      throw new AethexError("network", `ICE trickle failed (${res.status}).`, {
        status: res.status,
        recoverable: false,
      })
    }
  }

  /**
   * POST /sessions/:id/notify-ended — best-effort. Uses `keepalive` so it
   * survives a page unload. Never throws; ending a call must not fail loudly.
   */
  async end(sessionId: string): Promise<void> {
    try {
      await this.fetchImpl(this.url("end", sessionId), {
        method: "POST",
        headers: this.headers,
        keepalive: true,
      })
    } catch {
      /* swallow — teardown is best-effort */
    }
  }

  private url(kind: keyof AethexEndpoints, sessionId?: string): string {
    const path = this.endpoints[kind].replace(/:id|:sessionId/g, sessionId ?? "")
    return `${this.base}/${path.replace(/^\//, "")}`
  }

  private async request(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort(init.signal.reason)
    if (init.signal.aborted) ctrl.abort(init.signal.reason)
    else init.signal.addEventListener("abort", onAbort, { once: true })

    const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, headers: this.headers, signal: ctrl.signal })
    } catch (err) {
      if (init.signal.aborted) {
        throw new AethexError("aborted", "The call was stopped before signaling completed.", { cause: err })
      }
      if ((err as { name?: string })?.name === "TimeoutError") {
        throw new AethexError("timeout", `Signaling request timed out after ${this.timeoutMs}ms.`, {
          recoverable: true,
          cause: err,
        })
      }
      throw new AethexError("network", "Signaling request failed (network/CORS).", {
        recoverable: true,
        cause: err,
      })
    } finally {
      clearTimeout(timer)
      init.signal.removeEventListener("abort", onAbort)
    }
  }

  private mapConnectError(res: Response): AethexError {
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After")) || 60
      return new AethexError("quota_exceeded", "Call quota exceeded. Try again later.", {
        status: 429,
        recoverable: true,
        retryAfter,
      })
    }
    if (res.status === 402) {
      return new AethexError("payment_required", "Billing issue on this account.", {
        status: 402,
        recoverable: false,
      })
    }
    return new AethexError("connect_failed", `Failed to start the session (${res.status}).`, {
      status: res.status,
      recoverable: res.status >= 500,
    })
  }

  private mapOfferError(res: Response): AethexError {
    if (res.status === 503) {
      return new AethexError("capacity", "No voice capacity available right now.", {
        status: 503,
        recoverable: true,
      })
    }
    return new AethexError("offer_failed", `Failed to negotiate the call (${res.status}).`, {
      status: res.status,
      recoverable: res.status >= 500,
    })
  }
}
