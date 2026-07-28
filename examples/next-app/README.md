# Next.js (App Router) example

Minimal demo of `@aethexai/react` — shows both the headless hook and the
ready-made widget inside a client component.

## Setup

1. Run the signaling proxy (see [`../cloudflare-proxy`](../cloudflare-proxy)) on
   `http://localhost:8787`, or deploy it and use its URL.
2. Configure env vars (e.g. in `.env.local`):

   ```
   NEXT_PUBLIC_AETHEX_AGENT_ID=<your-agent-uuid>
   NEXT_PUBLIC_AETHEX_PROXY_URL=http://localhost:8787
   ```

3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

Open http://localhost:3000 and click **Call**. WebRTC needs HTTPS in production
(localhost is exempt).

## Notes

- `app/page.tsx` is a Client Component (`"use client"`) — required because it
  uses hooks. The SDK's React/widgets entries also ship a `"use client"` banner,
  so importing them from a Server Component would correctly mark the boundary.
- Microphone permission is requested on the first **Call** click.
- **Video orb.** A single `AethexVoiceOrb` floats bottom-right (its default) and
  plays one pre-rendered clip via `videoSrc` — no per-state swapping. The `.webm`
  clips ship **inside `@aethexai/react`** (the `./assets/*` export); the
  `predev`/`prebuild` step (`scripts/copy-orbs.mjs`) copies them from the package
  into `public/orbs` so Next can serve them. Swap `orb-green.webm` ↔
  `orb-magenta.webm`, or point `videoSrc` at your own clip.
- The hook demo also fetches the **transcript** once the call ends. Transcription
  isn't delivered live — after `status === "ended"`, `getTranscript({ apiBaseUrl,
sessionId })` returns the turns (`{ role, text, ... }`) from
  `GET /conversations/:id/transcript`.
