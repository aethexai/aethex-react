# @aethexai/react

React SDK for Aethex voice agents — **`useAethexCall()` hides WebRTC entirely**.

> Core (`VoiceCall`), React hooks (`useAethexCall`, `useAudioLevel`,
> `getTranscript`), and embeddable widgets (`AethexVoiceOrb` — the Agent Studio
> voice fingerprint, `AethexVoiceWidget`, `AethexCallButton`), plus an example
> Cloudflare proxy and a Next.js app. SSR- & StrictMode-safe, a11y-checked (axe),
> ESM + CJS + types, versioned with Changesets.

## Install

```bash
npm install @aethexai/react react react-dom
```

`react` / `react-dom` are peer dependencies for the hook; the `./core` entry
needs neither.

## React usage

```tsx
"use client"
import { useAethexCall, useAudioLevel } from "@aethexai/react"

export function CallButton() {
  const { status, isConnected, start, stop, remoteStream, error } = useAethexCall({
    agentId: "11111111-1111-1111-1111-111111111111",
    apiBaseUrl: "https://your-proxy.example.com", // a proxy, never a key
    onConnected: () => console.log("live"),
    onError: (e) => console.error(e.code, e.recoverable),
  })
  const { level } = useAudioLevel(remoteStream)

  if (error) return <p>Call failed: {error.code}</p>
  return (
    <button onClick={isConnected ? stop : start}>
      {status === "connecting" ? "Connecting…" : isConnected ? `Hang up (${level.toFixed(2)})` : "Call"}
    </button>
  )
}
```

`start()` never throws — observe `status` / `error`. The hook is SSR-safe (no
browser API at import or render) and StrictMode-safe (idempotent teardown).
The published React entry carries a `"use client"` banner for Next.js App Router.

Fetch the transcript **after** the call (live transcription isn't available):

```ts
import { getTranscript } from "@aethexai/react"
const turns = await getTranscript({ apiBaseUrl, sessionId })
```

## Embeddable widgets

Drop-in, accessible components built on the hook (import from `@aethexai/react/widgets`):

```tsx
import { AethexCallButton, AethexVoiceWidget, AethexVoiceOrb } from "@aethexai/react/widgets"

<AethexCallButton agentId={AGENT} apiBaseUrl={PROXY} />
<AethexVoiceWidget agentId={AGENT} apiBaseUrl={PROXY} title="Talk to Kora" />
```

Accessibility built in: native buttons (full keyboard), state conveyed by the
visible label, `aria-busy` while connecting (the button stays enabled so you can
cancel — no focus loss), a single `aria-live` status region, an `aria-hidden`
audio visualizer that degrades to a static indicator under
`prefers-reduced-motion`. Style via `className`/`style`; the error colour is
themeable with the `--aethex-error-color` CSS variable.

### Voice orb

`AethexVoiceOrb` is a self-contained orb-as-button. It **floats bottom-right by
default** (`position: fixed`) — the usual voice/chat-bubble spot; pass
`float={false}` to inline it, or `float="bottom-left"` / `floatOffset` / `zIndex`
to adjust. It renders an animated canvas orb (`orbType`) or, with `videoSrc`, a
looping muted `<video>` masked to a circle. Two ready-made clips ship in the
package under the `./assets/*` export:

```tsx
import { AethexVoiceOrb } from "@aethexai/react/widgets"
// Bundlers (Vite, webpack) resolve the asset URL for you:
import orb from "@aethexai/react/assets/orb-green.webm" // or orb-magenta.webm

function Widget() {
  return <AethexVoiceOrb agentId={AGENT} apiBaseUrl={PROXY} videoSrc={orb} />
}
```

The clips are **not** in the JS bundle (the widgets entry stays within its size
budget); they are shipped as separate files. In environments that serve static
files from a folder (e.g. Next.js `public/`), copy the clip out of the package —
see the [Next example](./examples/next-app) (`scripts/copy-orbs.mjs`). Honors
`prefers-reduced-motion` (the clip pauses on a still frame).

## Core usage (framework-agnostic)

The core is a pure-TS WebRTC client. It targets a **proxy** that holds your
`ae_live_...` key server-side — the key must never reach the browser.

```ts
import { VoiceCall } from "@aethexai/react/core"

const call = new VoiceCall({
  agentId: "11111111-1111-1111-1111-111111111111",
  apiBaseUrl: "https://your-proxy.example.com", // never the direct API / a key
  callbacks: {
    onStatusChange: (s) => console.log(s), // idle → connecting → connected → ended | error
    onRemoteStream: (stream) => {
      /* audio is auto-played via a managed <audio> */
    },
    onMetrics: (m) => console.log(m), // pipeline-metrics from the `chat` channel
    onError: (err) => console.error(err.code, err.recoverable),
    onClose: () => console.log("call ended"),
  },
})

await call.start()
// …
call.stop() // idempotent teardown: stops mic, closes peer, notifies the server
```

### Server-side status

`getRemoteStatus()` fetches the server's view of the session (duration, turn
count, lifecycle) — distinct from `status`, which is the local WebRTC state:

```ts
const s = await getRemoteStatus() // { session_id, status, duration_s, turn_count, … }
```

### ICE restart

If an established call's connection reaches `failed` (network dropped,
wifi→cellular), the SDK **automatically** renegotiates via the offer endpoint
(`restart_pc: true`) to recover, instead of surfacing `peer_failed`. A transient
`disconnected` is left to self-heal and never triggers a restart. This is **on
by default**. `maxIceRestarts` (default 1) caps _consecutive_ failed attempts —
the budget resets after each clean reconnect. Opt out with `iceRestart: false`
to fail fast:

```ts
useAethexCall({ agentId, apiBaseUrl, maxIceRestarts: 2 }) // recover harder
useAethexCall({ agentId, apiBaseUrl, iceRestart: false }) // fail fast
```

Requires the proxy to forward the offer body verbatim (the bundled example
worker does).

### Error handling

Every failure is an `AethexError` with a stable `code`:
`unsupported_browser`, `mic_denied`, `mic_missing`, `connect_failed`,
`offer_failed`, `quota_exceeded` (honours `Retry-After`), `payment_required`,
`capacity`, `peer_failed`, `timeout`, `aborted`, `network`, `unknown`.
Use `isAethexError(err)` to narrow, and `err.recoverable` to decide on retries.

## Security

- The API key **must** live in a proxy, never in client code. `apiBaseUrl` must
  point to that proxy. The SDK throws if the URL looks like a key.
- WebRTC + microphone require **HTTPS** (or `localhost`).

## Development

```bash
npm install
npm run typecheck      # strict TS
npm run lint           # eslint (flat config, react-hooks)
npm test               # vitest (jsdom) — core, hooks, widgets, SSR
npm run test:coverage  # with coverage thresholds
npm run build          # tsup → ESM + CJS + .d.ts + sourcemaps
npm run size           # size-limit budget
npm run check:exports  # publint + arethetypeswrong (node16 profile)
npm run ci             # the full gate (all of the above)
npm run docs           # typedoc → docs/api
```

## Release

Versioned with [Changesets](https://github.com/changesets/changesets):

```bash
npm run version   # apply pending changesets → bump version + CHANGELOG
npm run release   # build + changeset publish (requires npm auth + access)
```

## License

MIT
