# Next.js (App Router) example

A local demo of `@aethexai/react` — the headless hook, the ready-made widget,
and the voice orb — using the **ephemeral-token** flow. There is no separate
proxy to run: your API key stays on the server, and the browser connects with
short-lived tokens minted by `app/api/aethex/[...path]`.

## Run it

1. Build the SDK once (this example links it from `../..`):

   ```bash
   npm --prefix ../.. install
   npm --prefix ../.. run build
   ```

2. Set env in `.env.local`:

   ```
   AETHEX_API_KEY=ae_live_...              # server-side only, never shipped
   NEXT_PUBLIC_AETHEX_AGENT_ID=<agent-uuid>
   ```

3. Install and start:

   ```bash
   npm install
   npm run dev
   ```

Open http://localhost:3000, click **Call** (or tap the orb), allow the
microphone, and talk. WebRTC needs HTTPS in production; localhost is exempt.

## How it works

- `app/api/aethex/[...path]/route.ts` is a same-origin backend. It mints a call
  token (`POST /conversation/token`) with your key, and forwards the rest of the
  signaling, passing the browser's bearer token through so the demo runs the real
  token-auth path. Routing through it dodges CORS during local testing. In
  production, allow-list your app's origin on the Aethex API and drop `apiBaseUrl`
  in the client so the app talks to the API directly, no proxy at all.
- `app/page.tsx` is a Client Component. It calls `useAethexCall({ agentId,
getToken, apiBaseUrl })` and passes the same config to `AethexVoiceWidget` and
  `AethexVoiceOrb`.
- After the call ends it fetches the transcript through the same route.
  Transcription is not delivered live.

## Notes

- `app/page.tsx` is `"use client"` (it uses hooks). The SDK's React/widgets
  entries also carry a `"use client"` banner.
- The orb clips ship inside `@aethexai/react` (the `./assets/*` export);
  `scripts/copy-orbs.mjs` (predev/prebuild) copies them into `public/orbs` so
  Next can serve them. Swap `orb-green.webm` for `orb-magenta.webm`, or point
  `videoSrc` at your own clip.
