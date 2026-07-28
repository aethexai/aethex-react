import { describe, expect, it, vi } from "vitest"
import { Transport } from "../../src/core/transport.js"
import { AethexError } from "../../src/core/errors.js"

const BASE = "https://proxy.example.com"

function res(body: unknown, init?: { ok?: boolean; status?: number; retryAfter?: string }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: (h: string) => (h === "Retry-After" ? (init?.retryAfter ?? null) : null) },
    json: async () => body,
  } as unknown as Response
}

function transport(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new Transport({
    agentId: "a",
    apiBaseUrl: BASE,
    fetchImpl,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  })
}

const live = () => new AbortController().signal

describe("Transport", () => {
  it("connect posts agent_id and returns the body", async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(JSON.parse(String(init?.body))).toEqual({ agent_id: "agent-x" })
      return res({ session_id: "s1", ice_config: { iceServers: [] } })
    }) as unknown as typeof fetch
    const out = await transport(fetchImpl).connect("agent-x", live())
    expect(out.session_id).toBe("s1")
  })

  it("maps 429 → quota_exceeded with Retry-After, 402 → payment_required, 500 → recoverable connect_failed", async () => {
    const t429 = transport(
      vi.fn(async () => res(null, { ok: false, status: 429, retryAfter: "42" })) as unknown as typeof fetch,
    )
    await expect(t429.connect("a", live())).rejects.toMatchObject({ code: "quota_exceeded", retryAfter: 42 })

    const t402 = transport(
      vi.fn(async () => res(null, { ok: false, status: 402 })) as unknown as typeof fetch,
    )
    await expect(t402.connect("a", live())).rejects.toMatchObject({
      code: "payment_required",
      recoverable: false,
    })

    const t500 = transport(
      vi.fn(async () => res(null, { ok: false, status: 500 })) as unknown as typeof fetch,
    )
    await expect(t500.connect("a", live())).rejects.toMatchObject({
      code: "connect_failed",
      recoverable: true,
    })
  })

  it("maps 503 → capacity and 500 → offer_failed on the offer endpoint", async () => {
    const t503 = transport(
      vi.fn(async () => res(null, { ok: false, status: 503 })) as unknown as typeof fetch,
    )
    await expect(t503.sendOffer("s", { sdp: "x", type: "offer" }, live())).rejects.toMatchObject({
      code: "capacity",
    })

    const t500 = transport(
      vi.fn(async () => res(null, { ok: false, status: 500 })) as unknown as typeof fetch,
    )
    await expect(t500.sendOffer("s", { sdp: "x", type: "offer" }, live())).rejects.toMatchObject({
      code: "offer_failed",
    })
  })

  it("sendIce throws on a non-ok response", async () => {
    const t = transport(vi.fn(async () => res(null, { ok: false, status: 400 })) as unknown as typeof fetch)
    await expect(t.sendIce("s", "pc1", [], live())).rejects.toMatchObject({ code: "network" })
  })

  it("times out a hanging request", async () => {
    const hanging = vi.fn(
      (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason))
        }),
    ) as unknown as typeof fetch
    await expect(transport(hanging, 10).connect("a", live())).rejects.toMatchObject({ code: "timeout" })
  })

  it("maps a pre-aborted signal to aborted", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fetchImpl = vi.fn(
      (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const sig = init?.signal
          if (sig?.aborted) return reject(sig.reason) // already aborted: fire now
          sig?.addEventListener("abort", () => reject(sig.reason))
        }),
    ) as unknown as typeof fetch
    await expect(transport(fetchImpl).connect("a", ctrl.signal)).rejects.toMatchObject({ code: "aborted" })
  })

  it("maps a thrown fetch to a recoverable network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    await expect(transport(fetchImpl).connect("a", live())).rejects.toMatchObject({
      code: "network",
      recoverable: true,
    })
  })

  it("sendOffer carries pc_id + restart_pc:true for an ICE restart", async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return res({ sdp: "answer", type: "answer", pc_id: "pc-2" })
    }) as unknown as typeof fetch
    await transport(fetchImpl).sendOffer("s", { sdp: "x", type: "offer" }, live(), {
      pcId: "pc-1",
      restartPc: true,
    })
    expect(body).toMatchObject({ pc_id: "pc-1", restart_pc: true })
  })

  it("getStatus GETs the status endpoint and returns the body", async () => {
    const fetchImpl = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      expect(String(u)).toBe(`${BASE}/sessions/s/status`)
      expect(init?.method).toBe("GET")
      return res({ session_id: "s", status: "active", turn_count: 4 })
    }) as unknown as typeof fetch
    const out = await transport(fetchImpl).getStatus("s", live())
    expect(out).toMatchObject({ session_id: "s", turn_count: 4 })
  })

  it("end() is best-effort and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom")
    }) as unknown as typeof fetch
    await expect(transport(fetchImpl).end("s")).resolves.toBeUndefined()
  })

  it("throws when no fetch implementation is available", () => {
    const original = globalThis.fetch
    // @ts-expect-error force-remove for the test
    delete globalThis.fetch
    try {
      expect(() => new Transport({ agentId: "a", apiBaseUrl: BASE })).toThrow(AethexError)
    } finally {
      globalThis.fetch = original
    }
  })
})
