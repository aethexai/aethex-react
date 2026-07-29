# Aethex voice — Expo example

A minimal Expo app that places a live voice call to an Aethex agent from React
Native, using `@aethexai/react` — the **same `useAethexCall` hook as web** — on
top of `react-native-webrtc`.

> **Not Expo Go.** WebRTC is a native module, so this needs a **development
> build**. **iOS must run on a real device** (the iOS Simulator has no
> microphone). The **Android emulator** can use your computer's mic.

## 1. Build the SDK locally

This example resolves the SDK's local build via `metro.config.js`, so you can
test before anything is published. From the **repo root**:

```bash
npm install
npm run build
```

## 2. Install + align native deps

```bash
cd examples/expo-app
npm install
# Pin native module versions to this Expo SDK:
npx expo install expo-dev-client react-native-webrtc @config-plugins/react-native-webrtc
```

## 3. Point at your token endpoint + agent

This app uses the **ephemeral token** flow — the recommended path on mobile (no
proxy, no CORS). Your server mints a short-lived token with your API key; the app
connects to the Aethex API directly.

```bash
cp .env.example .env
# edit .env: your token-mint URL + an agent id
```

No server yet? Deploy [`examples/cloudflare-proxy`](../cloudflare-proxy) from this
repo — it exposes `POST /token` for exactly this. Its URL then ends in `/token`.

## 4. Prebuild + run on a device

```bash
npx expo prebuild --clean

# iOS — real device required (needs an Apple signing profile):
npx expo run:ios --device

# Android — device, or an emulator with
# "Virtual microphone uses host audio input" enabled:
npx expo run:android
```

Tap **Talk to the agent**, allow microphone access, and speak once `status`
reaches `connected`. The agent's audio plays through the device automatically —
no `<audio>` element on native.

## Loudspeaker routing (optional)

Remote audio plays through the default route. To force the loudspeaker and
manage the call audio session, add
[`react-native-incall-manager`](https://www.npmjs.com/package/react-native-incall-manager)
and start/stop it around the call:

```ts
import InCallManager from "react-native-incall-manager"
// on connect:
InCallManager.start({ media: "audio" })
InCallManager.setForceSpeakerphoneOn(true)
// on end:
InCallManager.stop()
```

## Notes

- Rebuild the dev client (`run:ios` / `run:android`) only when **native** deps
  change; day-to-day JS edits reload over Metro.
- If Metro can't find `@aethexai/react`, re-run `npm run build` in the repo root
  — this example resolves the SDK from `../../dist`.
