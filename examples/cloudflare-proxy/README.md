# Aethex signaling proxy (Cloudflare Worker)

A minimal, **signaling-only** proxy so the browser never sees your `ae_live_...`
key. The SDK points `apiBaseUrl` at this Worker's URL.

## Routes

The Worker exposes the routes the SDK calls and forwards each to the matching
Aethex API route (with the key attached):

| SDK call                            | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `POST /sessions`                    | Open a session, return `session_id` + ICE config |
| `POST /sessions/:id/offer`          | Exchange the SDP offer/answer (also ICE restart) |
| `PATCH /sessions/:id/ice`           | Trickle ICE candidates                           |
| `GET /sessions/:id/status`          | Server-side session status (duration, turns)     |
| `POST /sessions/:id/notify-ended`   | Signal the call ended                            |
| `GET /conversations/:id/transcript` | Fetch the transcript after the call              |

HTTP status codes (402/429/503 + `Retry-After`) are passed through verbatim so
the SDK's error mapping works.

## Run locally

```bash
npm i -g wrangler          # or: npx wrangler ...
cp .dev.vars.example .dev.vars   # put your real ae_live_ key here
wrangler dev               # serves on http://localhost:8787
```

Point the SDK at it:

```tsx
useAethexCall({ agentId, apiBaseUrl: "http://localhost:8787" })
```

## Deploy

```bash
wrangler secret put AETHEX_API_KEY   # paste the ae_live_ key (never in code)
wrangler deploy
```

## ⚠️ Production hardening (read before deploying)

This example keeps the key off the browser, but **CORS is not access control** —
it only constrains browsers. Anyone who learns the proxy URL can call it with
`curl` and burn your account's quota/billing. Before production you **must** add:

- **Rate limiting / WAF** in front of the Worker (Cloudflare Rate Limiting rules).
- A non-empty **`ALLOWED_AGENT_IDS`** so only your agents are reachable.
- A **real `ALLOWED_ORIGINS`** (never `*`); the Worker now emits no CORS header
  for unknown origins by default.
- Optionally, a short-lived signed token minted by your app and verified here.

## Config

- `AETHEX_API_KEY` — **secret**, set via `wrangler secret put` (or `.dev.vars`).
- `AETHEX_BASE_URL` — the Aethex API base (default `https://api.aethexai.com`).
- `ALLOWED_ORIGINS` — comma-separated browser origins for CORS (use your site's
  origin in production; `*` only for quick local testing).
- `ALLOWED_AGENT_IDS` — optional UUID allowlist; empty allows any `agent_id`.

This example is intentionally minimal — signaling only. The in-memory ICE
buffer is fine for local `wrangler dev`; in production, back it with a Durable
Object keyed by `session_id` so it survives across isolates.
