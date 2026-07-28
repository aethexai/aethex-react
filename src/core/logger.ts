/**
 * Injectable logger. Defaults to a no-op so the SDK is silent in production and
 * never logs conversation content or PII. Pass your own to plug in observability.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export const noopLogger: Logger = {
  debug: () => {},
  warn: () => {},
  error: () => {},
}
