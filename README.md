<p align="center">
  <img src="https://raw.githubusercontent.com/aethexai/aethex-react/main/.github/assets/aethex-react-banner.png" alt="Aethex React SDK" width="100%">
</p>

<h1 align="center">Aethex React SDK</h1>

<p align="center">
  <b>The React SDK for Aethex voice agents.</b><br>
  Start a live voice call with one hook, on the web or in React Native.<br>
  Drop in ready-made UI, or build your own. There is no WebRTC to wire up.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aethexai/react"><img alt="npm" src="https://img.shields.io/npm/v/@aethexai/react?style=flat-square&logo=npm&logoColor=white&label=npm&labelColor=0B0E14&color=38BDF8&cacheSeconds=300"></a>
  <a href="https://www.npmjs.com/package/@aethexai/react"><img alt="TypeScript" src="https://img.shields.io/badge/types-TypeScript-1E293B?style=flat-square&logo=typescript&logoColor=white&labelColor=0B0E14"></a>
  <img alt="Module: ESM + CJS" src="https://img.shields.io/badge/module-ESM%20%2B%20CJS-22D3EE?style=flat-square&labelColor=0B0E14">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-64748B?style=flat-square&labelColor=0B0E14"></a>
</p>

<p align="center">
  <a href="https://developers.aethexai.com/docs"><b>Documentation</b></a> &nbsp;·&nbsp;
  <a href="https://developers.aethexai.com/dashboard">Dashboard</a> &nbsp;·&nbsp;
  <a href="https://developers.aethexai.com/docs/api-reference">API Reference</a> &nbsp;·&nbsp;
  <a href="https://discord.gg/ccyuJNZm7x">Discord</a> &nbsp;·&nbsp;
  <a href="mailto:developers@aethexai.com">Support</a>
</p>

<br>

| 🎙️ Live voice                  | 🪝 One hook                     | 🧩 Drop-in widgets                            | ✨ Voice orb                        |
| :----------------------------- | :------------------------------ | :-------------------------------------------- | :---------------------------------- |
| Talk to any agent in real time | `useAethexCall()` runs the call | Orb with mute, hang-up, and feedback controls | A unique orb per agent, five styles |

## Install

```bash
npm install @aethexai/react react react-dom
```

`react` and `react-dom` are peer dependencies for the hook. The `./core` entry
needs neither. Ships ESM, CJS, and types. It is safe under SSR and StrictMode,
and accessibility is checked with axe. Versioned with Changesets.

## Quickstart

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

`start()` never throws, so watch `status` and `error` instead. The hook is
SSR-safe (no browser APIs at import or render) and StrictMode-safe (teardown is
idempotent). The React entry ships a `"use client"` banner for the Next.js App
Router.

Fetch the transcript after the call (live transcription is not available):

```ts
import { getTranscript } from "@aethexai/react"
const turns = await getTranscript({ apiBaseUrl, sessionId })
```

## Ephemeral tokens (skip the proxy)

Instead of proxying every request, mint a short-lived token on your server and
hand it to the client with `getToken`. The SDK then talks to the Aethex API
directly, so you host only a one-line mint route instead of a full proxy. Drop
`apiBaseUrl` and pass `getToken`:

```tsx
useAethexCall({
  agentId,
  getToken: async () => {
    const res = await fetch("/api/aethex-token", { method: "POST" })
    return (await res.json()).token
  },
})
```

Your mint route calls `POST /api/v1/conversation/token` with your API key and
returns the token. The [Cloudflare proxy example](./examples/cloudflare-proxy)
exposes it at `POST /token`. The token is scoped to one agent and expires with
the call, so it is safe to use from the client.

Browser callers need their origin allow-listed for CORS on the Aethex API.
React Native has no such restriction, so `getToken` is the recommended flow on
mobile.

## Widgets

Ready-made, accessible components built on the hook (import from `@aethexai/react/widgets`):

```tsx
import { AethexCallButton, AethexVoiceWidget, AethexVoiceOrb } from "@aethexai/react/widgets"

<AethexCallButton agentId={AGENT} apiBaseUrl={PROXY} />
<AethexVoiceWidget agentId={AGENT} apiBaseUrl={PROXY} title="Talk to Kora" />
```

Accessibility is built in: real buttons with full keyboard support, state shown
in the visible label, `aria-busy` while connecting (the button stays enabled so
you can cancel without losing focus), one `aria-live` status region, and an
`aria-hidden` audio visualizer that falls back to a static indicator under
`prefers-reduced-motion`. Style it with `className` or `style`. Set the error
color with the `--aethex-error-color` CSS variable.

### Voice orb

`AethexVoiceOrb` is the drop-in voice button: an orb, a label, and live status in
a themeable capsule (light or dark). One line, no styling required.

<p align="center">
  <img src="https://raw.githubusercontent.com/aethexai/aethex-react/main/.github/assets/aethex-react-capsule.png" alt="AethexVoiceOrb capsule in light and dark themes" width="100%">
</p>

```tsx
<AethexVoiceOrb agentId={AGENT} getToken={getToken} title="Talk to Kora" />
```

The orb is generated from the agent's name, so every agent gets its own colour
and texture. `orbType` picks one of five textures; `agentName` sets the seed:

<p align="center">
  <img src="https://raw.githubusercontent.com/aethexai/aethex-react/main/.github/assets/aethex-react-orbs.png" alt="The five orb styles: aurora, pulse, liquid, fluid, pixel" width="100%">
</p>

| `orbType` | Texture                           |
| :-------- | :-------------------------------- |
| `aurora`  | fine grain (the default)          |
| `pulse`   | medium blocks, punchy             |
| `liquid`  | smooth, no scanlines              |
| `fluid`   | fine and flowing                  |
| `pixel`   | chunky blocks with bold scanlines |

```tsx
<AethexVoiceOrb agentId={AGENT} getToken={getToken} orbType="liquid" agentName="Kora" />
```

It floats in the bottom-right corner by default (`position: fixed`), the usual
spot for a voice or chat bubble. Pass `float={false}` to inline it, or use
`float="bottom-left"`, `floatOffset`, and `zIndex` to adjust. The orb is still at
idle and animates only while connecting or in a call. It respects
`prefers-reduced-motion`.

Prefer a video? Pass `videoSrc` to show a looping muted `<video>` clipped to a
circle. Two ready-made clips ship in the package:

```tsx
import { AethexVoiceOrb } from "@aethexai/react/widgets"
// Bundlers (Vite, webpack) resolve the asset URL for you:
import orb from "@aethexai/react/assets/orb-green.webm" // or orb-magenta.webm

;<AethexVoiceOrb agentId={AGENT} apiBaseUrl={PROXY} videoSrc={orb} />
```

The clips are not in the JS bundle, so the widgets stay small. They ship as
separate files. If you serve static files from a folder (for example Next.js
`public/`), copy the clip out of the package. See the
[Next example](./examples/next-app) (`scripts/copy-orbs.mjs`).

### Call controls and feedback

Pass `controls` to add a mute toggle and a stylized red hang-up button under the
orb during a call, `showVolume` for an output-volume slider (web), and `feedback`
for a one-tap 👍 / 👎 rating once the call ends. All are off by default, so the
bare orb stays a single tap-to-call button.

<p align="center">
  <img src="https://raw.githubusercontent.com/aethexai/aethex-react/main/.github/assets/aethex-react-controls.png" alt="In-call mute and red hang-up controls, and a post-call rating prompt" width="100%">
</p>

```tsx
<AethexVoiceOrb agentId={AGENT} getToken={getToken} controls showVolume feedback />
```

Building your own UI? The hook exposes the same controls directly:

```tsx
const {
  isSpeaking, // true while the agent is talking (web)
  isMuted,
  setMuted,
  toggleMute,
  volume,
  setOutputVolume, // 0..1; device-level on native
  submitFeedback, // (rating 1..5, comment?) for the just-ended call
} = useAethexCall({ agentId, getToken })
```

`submitFeedback` posts the rating for the call the token opened. It works after
the call ends, so you can prompt for a rating on the summary screen.

## React Native (Expo)

The same hook runs in React Native. `@aethexai/react` ships a native build that
Metro resolves automatically, so the import is identical:

```tsx
import { useAethexCall } from "@aethexai/react"

function CallButton({ agentId, getToken }) {
  const { isConnected, start, stop } = useAethexCall({ agentId, getToken })
  return <Button title={isConnected ? "Hang up" : "Talk"} onPress={isConnected ? stop : start} />
}
```

On native the SDK runs on `react-native-webrtc` instead of browser WebRTC, and
the agent's audio plays through the device automatically. Use the
[ephemeral-token flow](#ephemeral-tokens-skip-the-proxy) (`getToken`) here: React
Native has no CORS, so the app connects to the Aethex API directly with no proxy
at all. WebRTC is a native module, so this needs an Expo **development build** (it
does not run in Expo Go).

Install the native peers and add the config plugin:

```bash
npx expo install react-native-webrtc @config-plugins/react-native-webrtc expo-dev-client
```

```json
// app.json
{
  "expo": {
    "plugins": [
      [
        "@config-plugins/react-native-webrtc",
        { "microphonePermission": "Allow $(PRODUCT_NAME) to use your microphone." }
      ]
    ]
  }
}
```

Then build to a device:

```bash
npx expo prebuild --clean
npx expo run:ios --device   # iOS needs a real device (the Simulator has no mic)
npx expo run:android        # an emulator is fine with host-mic input enabled
```

`AethexVoiceOrb` runs on native too, rendered with
[`@shopify/react-native-skia`](https://shopify.github.io/react-native-skia/)
instead of a DOM canvas. Same props as the web orb, including `controls` and
`feedback`, so the mute and hang-up buttons and the rating prompt work on device:

```tsx
import { AethexVoiceOrb } from "@aethexai/react/widgets"

;<AethexVoiceOrb agentId={AGENT} getToken={getToken} controls feedback />
```

Add its peers alongside the WebRTC ones. `react-native-incall-manager` routes the
agent to the loudspeaker, and Skia needs `react-native-reanimated` (add
`react-native-reanimated/plugin` to `babel.config.js`, last in the list):

```bash
npx expo install @shopify/react-native-skia react-native-reanimated react-native-incall-manager
```

`AethexVoiceWidget` and `AethexCallButton` are web-only; on native, use the orb
or build on the hook. The audio-level hooks (`useAudioLevel`, `useAudioLevelRef`)
and `isSpeaking` rely on Web Audio, so they read `0` on native; the orb
self-animates during a call instead of reacting to the audio. A full runnable app
is in [`examples/expo-app`](./examples/expo-app).

## Core (framework-agnostic)

The core is a plain TypeScript WebRTC client. It talks to a proxy that keeps
your `ae_live_...` key on the server. The key must never reach the browser.

```ts
import { VoiceCall } from "@aethexai/react/core"

const call = new VoiceCall({
  agentId: "11111111-1111-1111-1111-111111111111",
  apiBaseUrl: "https://your-proxy.example.com", // never the direct API or a key
  callbacks: {
    onStatusChange: (s) => console.log(s), // idle, connecting, connected, ended, error
    onRemoteStream: (stream) => {
      /* audio is played automatically through a managed <audio> */
    },
    onMetrics: (m) => console.log(m), // pipeline metrics from the `chat` channel
    onError: (err) => console.error(err.code, err.recoverable),
    onClose: () => console.log("call ended"),
  },
})

await call.start()
// …
call.stop() // idempotent teardown: stops the mic, closes the peer, tells the server
```

### Server-side status

`getRemoteStatus()` returns the server's view of the session (duration, turn
count, lifecycle). This is different from `status`, which is the local WebRTC
state:

```ts
const s = await getRemoteStatus() // { session_id, status, duration_s, turn_count, … }
```

### ICE restart

If a live call drops (network change, wifi to cellular), the SDK reconnects on
its own by renegotiating (`restart_pc: true`) instead of failing. A brief
`disconnected` is left to recover by itself. This is on by default.
`maxIceRestarts` (default 1) caps how many failed attempts in a row it will try,
and the budget resets after each clean reconnect. Set `iceRestart: false` to
fail fast instead:

```ts
useAethexCall({ agentId, apiBaseUrl, maxIceRestarts: 2 }) // recover harder
useAethexCall({ agentId, apiBaseUrl, iceRestart: false }) // fail fast
```

This needs the proxy to forward the offer body as-is (the bundled example worker
does).

### Error handling

Every failure is an `AethexError` with a stable `code`:
`unsupported_browser`, `mic_denied`, `mic_missing`, `connect_failed`,
`offer_failed`, `quota_exceeded` (honors `Retry-After`), `payment_required`,
`capacity`, `peer_failed`, `timeout`, `aborted`, `network`, `unknown`.
Use `isAethexError(err)` to narrow the type, and `err.recoverable` to decide
whether to retry.

## Security

- Your API key must live in a proxy, never in client code. `apiBaseUrl` must
  point to that proxy. The SDK throws if the URL looks like a key.
- WebRTC and the microphone need HTTPS (or `localhost`).

See the [Cloudflare proxy example](./examples/cloudflare-proxy) for a small,
production-shaped proxy that keeps your key on the server.

## Development

```bash
npm install
npm run typecheck      # strict TS
npm run lint           # eslint (flat config, react-hooks)
npm test               # vitest (jsdom): core, hooks, widgets, SSR
npm run test:coverage  # with coverage thresholds
npm run build          # tsup: ESM, CJS, .d.ts, sourcemaps
npm run size           # size-limit budget
npm run check:exports  # publint + arethetypeswrong (node16 profile)
npm run ci             # the full gate (all of the above)
npm run docs           # typedoc to docs/api
```

## Release

Versioned with [Changesets](https://github.com/changesets/changesets):

```bash
npm run version   # apply pending changesets: bump version and CHANGELOG
npm run release   # build and publish (needs npm auth and access)
```

## License

MIT © [AethexAI](https://aethexai.com)

<p align="center"><sub>Voice AI, built for the people it serves.</sub></p>
