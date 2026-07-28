import { AethexError } from "../core/errors.js"

/**
 * A single utterance in a conversation transcript, as returned by
 * `GET /conversations/:id/transcript`. Field names match the API verbatim.
 */
export interface TranscriptTurn {
  /** Speaker role — `"user"` or `"assistant"`. */
  role: string
  /** What was said. (API field is `text`, not `content`.) */
  text: string
  /** 0-based position of the turn in the conversation. */
  turn_index?: number
  /** End-to-end latency for the turn, in ms (null if unavailable). */
  total_latency_ms?: number | null
  /** Tool calls the agent made on this turn, if any. */
  tool_calls?: unknown[] | null
  /** ISO 8601 timestamp of when the turn was recorded. */
  created_at?: string
  [key: string]: unknown
}

export interface GetTranscriptOptions {
  /** Base URL of the proxy (same as the call's `apiBaseUrl`). */
  apiBaseUrl: string
  /** The session/conversation id (they are equal). */
  sessionId: string
  /** Path template on the proxy. Default `conversations/:id/transcript`. */
  path?: string
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Per-request timeout in ms. Default 15000. Pass 0 to disable. */
  timeoutMs?: number
}

/**
 * Fetch the transcript **after** a call ends. Live transcription is not
 * available during the call, so this is the supported way to read what was said.
 */
export async function getTranscript(options: GetTranscriptOptions): Promise<TranscriptTurn[]> {
  const {
    apiBaseUrl,
    sessionId,
    path = "conversations/:id/transcript",
    headers,
    signal,
    timeoutMs = 15_000,
  } = options
  const impl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined)
  if (!impl) throw new AethexError("network", "No fetch implementation is available.")

  const base = apiBaseUrl.replace(/\/$/, "")
  // Encode the id as a path segment, and use a function replacer so a `$` in the
  // id can't be read as a `$&`/`$1` replacement pattern.
  const rel = path.replace(/:id|:sessionId/g, () => encodeURIComponent(sessionId)).replace(/^\//, "")
  const url = `${base}/${rel}`

  // Own timeout + abort wiring: a hung connection must reject, not hang the
  // caller forever. The internal controller also mirrors the caller's signal.
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason)
    else signal.addEventListener("abort", onAbort, { once: true })
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs)
      : undefined

  let res: Response
  try {
    res = await impl(url, { method: "GET", ...(headers ? { headers } : {}), signal: ctrl.signal })
  } catch (err) {
    if (signal?.aborted) {
      throw new AethexError("aborted", "The transcript request was aborted.", { cause: err })
    }
    if ((err as { name?: string })?.name === "TimeoutError") {
      throw new AethexError("timeout", `Transcript request timed out after ${timeoutMs}ms.`, {
        recoverable: true,
        cause: err,
      })
    }
    throw new AethexError("network", "Failed to fetch the transcript.", { cause: err, recoverable: true })
  } finally {
    if (timer) clearTimeout(timer)
    if (signal) signal.removeEventListener("abort", onAbort)
  }
  if (!res.ok) {
    throw new AethexError("network", `Transcript request failed (${res.status}).`, {
      status: res.status,
      recoverable: res.status >= 500,
    })
  }
  let body: TranscriptTurn[] | { turns?: TranscriptTurn[] }
  try {
    body = (await res.json()) as TranscriptTurn[] | { turns?: TranscriptTurn[] }
  } catch (err) {
    throw new AethexError("network", "Transcript response was not valid JSON.", { cause: err })
  }
  if (Array.isArray(body)) return body
  return Array.isArray(body.turns) ? body.turns : []
}
