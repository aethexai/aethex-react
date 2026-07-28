"use client"

import { useEffect, useState } from "react"
import { AethexVoiceWidget, AethexVoiceOrb } from "@aethexai/react/widgets"
import { useAethexCall, useAudioLevel, getTranscript } from "@aethexai/react"
import type { TranscriptTurn, SessionStatusResponse } from "@aethexai/react"

const AGENT_ID = process.env.NEXT_PUBLIC_AETHEX_AGENT_ID ?? "00000000-0000-0000-0000-000000000000"
// Point at your deployed signaling proxy (see ../../cloudflare-proxy).
const PROXY_URL = process.env.NEXT_PUBLIC_AETHEX_PROXY_URL ?? "http://localhost:8787"

// Orb clip served from public/orbs. The .webm ships inside @aethexai/react and
// is copied here by the predev/prebuild step (see scripts/copy-orbs.mjs); the
// widget just takes the URL. Swap to orb-magenta.webm for the other color.
const ORB_VIDEO = "/orbs/orb-green.webm"

/** Hook-based usage: full control over the UI, plus the post-call transcript. */
function CustomCall() {
  const { status, isConnected, start, stop, remoteStream, error, sessionId, getRemoteStatus } = useAethexCall(
    {
      agentId: AGENT_ID,
      apiBaseUrl: PROXY_URL,
      // ICE restart is on by default: if the connection reaches `failed`
      // (network dropped, wifi→cellular), the SDK renegotiates automatically to
      // recover before surfacing an error. Nothing to wire up here — set
      // `iceRestart: false` to opt out.
    },
  )
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
        const turns = await getTranscript({ apiBaseUrl: PROXY_URL, sessionId })
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
    <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui", display: "grid", gap: 32 }}>
      <h1>@aethexai/react demo</h1>

      <section>
        <h2>Orb (`AethexVoiceOrb`)</h2>
        <p style={{ color: "#697086", fontSize: 13, marginTop: -8 }}>
          Floats bottom-right by default (look in the corner ↘). Tap it to start a call — the same clip runs
          throughout. Pass <code>float={"{false}"}</code> to inline it, or{" "}
          <code>float=&quot;bottom-left&quot;</code> / <code>floatOffset</code> / <code>zIndex</code> to
          adjust.
        </p>
      </section>

      <section>
        <h2>Widget (`AethexVoiceWidget`)</h2>
        <AethexVoiceWidget agentId={AGENT_ID} apiBaseUrl={PROXY_URL} title="Talk to the demo agent" />
      </section>

      <section>
        <CustomCall />
      </section>

      {/* The single orb: floating (default bottom-right) with one video clip —
          no per-state swapping. The clip ships in @aethexai/react and is copied
          to public/orbs by the predev/prebuild step. */}
      <AethexVoiceOrb
        agentId={AGENT_ID}
        apiBaseUrl={PROXY_URL}
        videoSrc={ORB_VIDEO}
        size="lg"
        labels={{ startAction: "Start talking", stopAction: "Hang up" }}
      />
    </main>
  )
}
