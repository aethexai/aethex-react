"use client"

import { useEffect, useState } from "react"
import { AethexVoiceOrb } from "@aethexai/react/widgets"
import { useAethexCall, useAudioLevel, getTranscript } from "@aethexai/react"
import type { TranscriptTurn, SessionStatusResponse } from "@aethexai/react"

const AGENT_ID = process.env.NEXT_PUBLIC_AETHEX_AGENT_ID ?? "00000000-0000-0000-0000-000000000000"

// Same-origin backend (app/api/aethex/[...path]) that mints tokens with your key
// and forwards signaling. See its comment for the local-vs-production tradeoff.
const API_PROXY = "/api/aethex"

// Ephemeral-token flow: fetch a short-lived call token from our server route,
// then let the SDK authenticate signaling with it. The API key never reaches
// the browser.
async function getToken(): Promise<string> {
  const res = await fetch(`${API_PROXY}/conversation/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: AGENT_ID }),
  })
  if (!res.ok) throw new Error(`token mint failed (${res.status})`)
  return (await res.json()).token as string
}

// Shared call config: agent + token minting, routed through the same-origin proxy.
const callConfig = { agentId: AGENT_ID, getToken, apiBaseUrl: API_PROXY }

// A live showcase of the seeded canvas orb: five textures, each with a different
// seed name so the colours vary. `agentName` only sets the look; every orb still
// calls the same agent. Tap any to place a call.
const ORB_STYLES = [
  { orbType: "aurora", agentName: "Kora" },
  { orbType: "pulse", agentName: "Rhea" },
  { orbType: "liquid", agentName: "Nia" },
  { orbType: "fluid", agentName: "Nova" },
  { orbType: "pixel", agentName: "Bianca" },
] as const

// Orb clip served from public/orbs. The .webm ships inside @aethexai/react and
// is copied here by the predev/prebuild step (see scripts/copy-orbs.mjs); the
// widget just takes the URL. Swap to orb-magenta.webm for the other color.
const ORB_VIDEO = "/orbs/orb-green.webm"

/** Hook-based usage: full control over the UI, plus the post-call transcript. */
function CustomCall() {
  const { status, isConnected, start, stop, remoteStream, error, sessionId, getRemoteStatus } =
    useAethexCall(callConfig)
  const { level } = useAudioLevel(remoteStream)
  const [transcript, setTranscript] = useState<TranscriptTurn[] | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<SessionStatusResponse | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Transcription isn't delivered live — fetch it after the call ends.
  // The transcript is only finalized once the call's `/end` request completes
  // server-side, which races with the "ended" status firing here. So poll
  // briefly (empty array / 404 = "not ready yet") until the turns appear.
  useEffect(() => {
    if (status !== "ended" || !sessionId) return
    let cancelled = false
    const MAX_ATTEMPTS = 5
    const RETRY_MS = 1000
    setLoadingTranscript(true)
    setTranscriptError(null)

    const attempt = async (n: number): Promise<void> => {
      try {
        const turns = await getTranscript({ apiBaseUrl: API_PROXY, sessionId })
        if (cancelled) return
        if (turns.length === 0 && n < MAX_ATTEMPTS) {
          setTimeout(() => attempt(n + 1), RETRY_MS) // still finalizing → retry
          return
        }
        setTranscript(turns)
        setLoadingTranscript(false)
      } catch (err) {
        if (cancelled) return
        if (n < MAX_ATTEMPTS) {
          setTimeout(() => attempt(n + 1), RETRY_MS) // 404 while finalizing → retry
          return
        }
        setTranscriptError((err as { code?: string })?.code ?? "fetch_failed")
        setLoadingTranscript(false)
      }
    }
    void attempt(1)
    return () => {
      cancelled = true
    }
  }, [status, sessionId])

  // Server-side status (duration, turn count) — distinct from the local WebRTC
  // `status`. Works during the call AND after it ends (unlike the transcript,
  // which is finalized only post-call). Handy for a live "call duration" readout.
  const refreshStatus = async () => {
    setStatusError(null)
    try {
      setRemoteStatus(await getRemoteStatus())
    } catch (err) {
      setStatusError((err as { code?: string })?.code ?? "fetch_failed")
    }
  }

  return (
    <div>
      <h2>Hook (`useAethexCall`) + transcript</h2>
      <p style={{ color: "#697086", fontSize: 13, marginTop: -8 }}>
        The headless hook. You render your own UI; this bare button is deliberately unstyled. Use it when you
        want full control (and it also fetches the transcript after the call).
      </p>
      <button onClick={isConnected ? stop : start} aria-busy={status === "connecting"}>
        {status === "connecting" ? "Connecting…" : isConnected ? `Hang up · ${level.toFixed(2)}` : "Call"}
      </button>
      {error && <p style={{ color: "crimson" }}>Error: {error.code}</p>}

      {sessionId && (
        <div style={{ marginTop: 12 }}>
          <button onClick={refreshStatus} style={{ fontSize: 13 }}>
            Refresh session status
          </button>
          {statusError && <p style={{ color: "crimson", fontSize: 13 }}>Status error: {statusError}</p>}
          {remoteStatus && (
            <p style={{ color: "#697086", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {remoteStatus.status}
              {remoteStatus.duration_s != null && ` · ${remoteStatus.duration_s}s`}
              {remoteStatus.turn_count != null && ` · ${remoteStatus.turn_count} turns`}
            </p>
          )}
        </div>
      )}

      {loadingTranscript && <p style={{ color: "#697086", fontSize: 13 }}>Loading transcript…</p>}
      {transcriptError && (
        <p style={{ color: "crimson", fontSize: 13 }}>Transcript error: {transcriptError}</p>
      )}
      {transcript?.length === 0 && !loadingTranscript && (
        <p style={{ color: "#697086", fontSize: 13 }}>No transcript for this call.</p>
      )}
      {transcript && transcript.length > 0 && (
        <ul style={{ marginTop: 16, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {transcript.map((turn, i) => (
            <li key={turn.turn_index ?? i} style={{ fontSize: 14 }}>
              <strong style={{ color: turn.role === "assistant" ? "#7C6CFF" : "#34E3C4" }}>
                {turn.role}:
              </strong>{" "}
              {turn.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", fontFamily: "system-ui", display: "grid", gap: 32 }}>
      <h1>@aethexai/react demo</h1>

      <section>
        <h2>Orb (`AethexVoiceOrb`)</h2>
        <p style={{ color: "#697086", fontSize: 13, marginTop: -8 }}>
          The orb is generated from the agent&apos;s name, so every agent gets its own colour and texture. Tap
          one to call. <code>orbType</code> picks the texture; <code>agentName</code> sets the seed.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 26,
            justifyContent: "center",
            padding: 28,
            marginTop: 12,
            background: "#0B0E14",
            borderRadius: 16,
          }}
        >
          {ORB_STYLES.map((o) => (
            <div key={o.orbType} style={{ display: "grid", gap: 10, justifyItems: "center" }}>
              <AethexVoiceOrb
                {...callConfig}
                float={false}
                theme="dark"
                size="lg"
                orbType={o.orbType}
                agentName={o.agentName}
              />
              <span
                style={{
                  color: "rgba(231,234,243,0.75)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                }}
              >
                {o.orbType}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Drop-in (`AethexVoiceOrb` with a title)</h2>
        <p style={{ color: "#697086", fontSize: 13, marginTop: -8 }}>
          One line, no styling needed: an orb, a label, and live status in a themeable capsule.
        </p>
        <AethexVoiceOrb {...callConfig} float={false} size="lg" agentName="Kora" title="Talk to Kora" />
      </section>

      <section>
        <CustomCall />
      </section>

      {/* The single orb: floating (default bottom-right) with one video clip —
          no per-state swapping. The clip ships in @aethexai/react and is copied
          to public/orbs by the predev/prebuild step. */}
      <AethexVoiceOrb
        {...callConfig}
        videoSrc={ORB_VIDEO}
        size="lg"
        labels={{ startAction: "Start talking", stopAction: "Hang up" }}
      />
    </main>
  )
}
