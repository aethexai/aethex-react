/**
 * Typed error taxonomy. Every failure surfaced by the SDK is an `AethexError`
 * with a stable `code` so consumers can branch without string-matching messages.
 */

export type AethexErrorCode =
  | "unsupported_browser" // no RTCPeerConnection / getUserMedia
  | "mic_denied" //          user/policy denied microphone
  | "mic_missing" //         getUserMedia returned no audio tracks / no device
  | "connect_failed" //      POST /sessions failed (non-quota)
  | "offer_failed" //        POST /offer failed (non-capacity)
  | "quota_exceeded" //      429 — honor Retry-After
  | "payment_required" //    402 — billing
  | "capacity" //            503 — no voice capacity available
  | "peer_failed" //         RTCPeerConnection went to failed/closed unexpectedly
  | "timeout" //             a signaling request exceeded timeoutMs
  | "aborted" //             call was stopped / unmounted mid-flight
  | "network" //             fetch threw (offline, CORS, DNS…)
  | "unknown" //             unexpected error not attributable to a known cause

export interface AethexErrorOptions {
  /** Whether retrying the call could plausibly succeed. */
  recoverable?: boolean
  /** Seconds to wait before retrying (from a 429 `Retry-After`). */
  retryAfter?: number
  /** HTTP status when the error originates from a signaling response. */
  status?: number
  /** Underlying error/cause for debugging. */
  cause?: unknown
}

export class AethexError extends Error {
  readonly code: AethexErrorCode
  readonly recoverable: boolean
  readonly retryAfter: number | undefined
  readonly status: number | undefined

  constructor(code: AethexErrorCode, message: string, options: AethexErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = "AethexError"
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.retryAfter = options.retryAfter
    this.status = options.status
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, AethexError.prototype)
  }
}

/** Type guard so consumers can narrow caught errors safely. */
export function isAethexError(value: unknown): value is AethexError {
  return value instanceof AethexError
}

/**
 * Build an `AbortController` abort reason that works everywhere. The browser
 * uses `DOMException`, but React Native (Hermes) may not define it — so fall
 * back to a plain `Error` carrying the same `name`, which is all our code (and
 * the fetch/abort machinery) inspects.
 */
export function abortReason(name: "AbortError" | "TimeoutError", message: string): Error {
  if (typeof DOMException !== "undefined") return new DOMException(message, name)
  const err = new Error(message)
  err.name = name
  return err
}

/**
 * Map a DOMException from getUserMedia / Permissions to the right code.
 * `NotAllowedError`/`SecurityError` → denied; `NotFoundError` → missing device.
 */
export function fromMediaError(err: unknown): AethexError {
  const name = (err as { name?: string } | null)?.name
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new AethexError("mic_denied", "Microphone permission was denied.", {
      recoverable: false,
      cause: err,
    })
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new AethexError("mic_missing", "No usable microphone was found.", {
      recoverable: false,
      cause: err,
    })
  }
  return new AethexError("mic_denied", "Could not access the microphone.", {
    recoverable: false,
    cause: err,
  })
}
