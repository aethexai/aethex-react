# @aethexai/react

## 1.0.0

First stable release. Adds React Native support, in-call controls, and end-of-call feedback.

- **React Native**: the hook and `AethexVoiceOrb` run on native through a WebRTC
  platform adapter (`react-native-webrtc`), with the orb rendered by
  `@shopify/react-native-skia`. Metro resolves the native build automatically, and
  `react-native-incall-manager` routes the agent to the loudspeaker.
- **Call controls**: `setMuted` / `toggleMute` / `isMuted`, `setOutputVolume` /
  `volume`, and `isSpeaking` (derived from a WebAudio output meter on the web).
- **Feedback**: `submitFeedback(rating, comment?)` posts an end-of-call rating,
  authorized by the call token.
- **Orb controls**: `AethexVoiceOrb` gains opt-in `controls` (mute plus a red
  hang-up button), a web `showVolume` slider, and a post-call `feedback` prompt,
  on web and native.
- **Ephemeral tokens**: `getToken` mints a short-lived token so you can skip the
  proxy entirely (recommended on mobile, where there is no CORS).
- Renamed the orb seed prop `voiceName` to `agentName` (`voiceName` still works, deprecated).

## 0.1.0

Initial public release.

- **`useAethexCall()`** — a React hook that runs a full Aethex voice call and hides
  WebRTC entirely (mic → signaling → peer connection → teardown). SSR- and
  StrictMode-safe; the React entries carry a `"use client"` banner.
- **Core** — a framework-agnostic `VoiceCall` client, plus `useAudioLevel` and a
  post-call `getTranscript` helper. Server-side session status via
  `getRemoteStatus()`, and automatic **ICE restart** (on by default) to recover a
  dropped connection instead of surfacing `peer_failed`.
- **Widgets** (`@aethexai/react/widgets`):
  - **`AethexVoiceOrb`** — the Agent Studio voice fingerprint: a deterministic
    canvas orb whose colour + pattern are seeded from the agent/voice name. Static
    at idle, animates only while connecting / in a call. Texture variants via
    `orbType`, an optional `videoSrc` clip, and floating placement (`float`).
  - **`AethexVoiceWidget`** and **`AethexCallButton`** — drop-in, accessible
    controls built on the hook.
- The API key stays server-side: the SDK targets a **proxy** (a Cloudflare example
  is included) and never touches the key. A Next.js example app is included too.
- Ships ESM + CJS + TypeScript types (packaging validated with publint + attw).
- Eager ICE trickling fixes calls on Firefox and other TURN-only / symmetric-NAT
  paths.
