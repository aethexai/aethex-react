import { AethexError, abortReason } from "./errors.js"
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
  feedback: "sessions/:id/feedback",
}

// Direct Aethex API — the default target in ephemeral-token mode (getToken).
const AETHEX_API_BASE = "https://api.aethexai.com/api/v1"

// The real conversation routes, used when talking to the API directly with a
// call token (instead of a proxy's `sessions/*` paths).
const CONVERSATION_ENDPOINTS: AethexEndpoints = {
  connect: "conversation/connect",
  offer: "conversation/:id/offer",
  ice: "conversation/:id/ice",
  end: "conversation/:id/end",
  status: "conversation/:id/status",
  // The feedback route lives on the conversations resource (plural), keyed by
  // the conversation id and authorized by the call token pinned to it.
  feedback: "conversations/:id/feedback",
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
  private readonly getTokenFn: (() => string | Promise<string>) | undefined
  private authToken: string | null = null

  constructor(config: AethexCallConfig) {
    const tokenMode = typeof config.getToken === "function"
    const base = config.apiBaseUrl ?? (tokenMode ? AETHEX_API_BASE : undefined)
    if (!base) {
      throw new AethexError("connect_failed", "apiBaseUrl is required (or pass getToken).")
    }
    this.base = base.replace(/\/$/, "")
    // Token mode targets the real API, so it uses the conversation routes; a
    // proxy uses the `sessions/*` defaults. Either is overridable per endpoint.
    this.endpoints = {
      ...(tokenMode ? CONVERSATION_ENDPOINTS : DEFAULT_ENDPOINTS),
      ...config.endpoints,
    }
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.getTokenFn = config.getToken
    const globalFetch = typeof fetch !== "undefined" ? fetch : undefined
    const impl = config.fetchImpl ?? globalFetch
    if (!impl) {
      throw new AethexError("network", "No fetch implementation is available.")
    }
    // Bind to avoid "Illegal invocation" when fetch is the global.
    this.fetchImpl = impl.bind(globalThis)
    this.headers = { "Content-Type": "application/json", ...config.headers }
  }

  /**
   * Mint/fetch the ephemeral call token (once) and arm it as the bearer
   * credential. No-op when `getToken` isn't configured (proxy mode). Call before
   * the first signaling request.
   */
  async ensureAuth(): Promise<void> {
    if (!this.getTokenFn || this.authToken) return
    let token: string
    try {
      token = await this.getTokenFn()
    } catch (err) {
      throw new AethexError("connect_failed", "getToken() failed to mint a call token.", {
        recoverable: true,
        cause: err,
      })
    }
    if (!token) throw new AethexError("connect_failed", "getToken() returned an empty token.")
    this.authToken = token
  }

  private authHeaders(): Record<string, string> {
    return this.authToken ? { ...this.headers, Authorization: `Bearer ${this.authToken}` } : this.headers
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

  /**
   * POST /sessions/:id/feedback { rating, comment? } — end-of-call rating.
   * `rating` is clamped to 1..5; an empty/absent comment is omitted.
   */
  async submitFeedback(
    sessionId: string,
    feedback: { rating: number; comment?: string },
    signal: AbortSignal,
  ): Promise<void> {
    const rating = Math.max(1, Math.min(5, Math.round(feedback.rating)))
    const body: { rating: number; comment?: string } = { rating }
    if (feedback.comment != null && feedback.comment !== "") body.comment = feedback.comment
    const res = await this.request(this.url("feedback", sessionId), {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      throw new AethexError("network", `Failed to submit feedback (${res.status}).`, {
        status: res.status,
        recoverable: res.status >= 500,
      })
    }
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
        headers: this.authHeaders(),
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

    const timer = setTimeout(() => ctrl.abort(abortReason("TimeoutError", "timeout")), this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, headers: this.authHeaders(), signal: ctrl.signal })
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
