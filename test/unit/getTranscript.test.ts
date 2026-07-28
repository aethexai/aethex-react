import { describe, expect, it, vi } from "vitest"
import { getTranscript } from "../../src/react/getTranscript.js"
import { AethexError } from "../../src/core/errors.js"

const BASE = "https://proxy.example.com"

function res(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

describe("getTranscript", () => {
  it("GETs the default conversations/:id/transcript path and returns an array", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => res([{ role: "user", text: "hi" }]))
    const turns = await getTranscript({
      apiBaseUrl: BASE,
      sessionId: "sess-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://proxy.example.com/conversations/sess-1/transcript")
    expect(turns).toEqual([{ role: "user", text: "hi" }])
  })

  it("unwraps a { turns } envelope", async () => {
    const fetchImpl = vi.fn(async () => res({ turns: [{ role: "assistant", text: "yo" }] }))
    const turns = await getTranscript({
      apiBaseUrl: BASE,
      sessionId: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(turns).toEqual([{ role: "assistant", text: "yo" }])
  })

  it("throws an AethexError on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => res(null, { ok: false, status: 404 }))
    await expect(
      getTranscript({ apiBaseUrl: BASE, sessionId: "s", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(AethexError)
  })

  it("wraps a non-JSON body in a network error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <")
      },
    })) as unknown as typeof fetch
    await expect(getTranscript({ apiBaseUrl: BASE, sessionId: "s", fetchImpl })).rejects.toMatchObject({
      code: "network",
    })
  })

  it("returns [] when turns is not an array", async () => {
    const fetchImpl = vi.fn(async () => res({ turns: "oops" })) as unknown as typeof fetch
    expect(await getTranscript({ apiBaseUrl: BASE, sessionId: "s", fetchImpl })).toEqual([])
  })

  it("times out a hanging request with code 'timeout'", async () => {
    const hanging = vi.fn(
      (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason))
        }),
    ) as unknown as typeof fetch
    await expect(
      getTranscript({ apiBaseUrl: BASE, sessionId: "s", fetchImpl: hanging, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: "timeout", recoverable: true })
  })

  it("maps a pre-aborted signal to 'aborted'", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fetchImpl = vi.fn(
      (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const sig = init?.signal
          if (sig?.aborted) return reject(sig.reason)
          sig?.addEventListener("abort", () => reject(sig.reason))
        }),
    ) as unknown as typeof fetch
    await expect(
      getTranscript({ apiBaseUrl: BASE, sessionId: "s", fetchImpl, signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: "aborted" })
  })

  it("wraps a thrown fetch in a recoverable network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline")
    })
    await expect(
      getTranscript({ apiBaseUrl: BASE, sessionId: "s", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "network", recoverable: true })
  })

  it("returns [] when the envelope has no turns and honors a custom path", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => res({}))
    const turns = await getTranscript({
      apiBaseUrl: BASE,
      sessionId: "s",
      path: "t/:id",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(turns).toEqual([])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://proxy.example.com/t/s")
  })
})
