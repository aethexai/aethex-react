/**
 * Wire types for the Aethex signaling contract.
 *
 * The SDK never talks to the Aethex API directly — it targets a proxy
 * (see `apiBaseUrl`) that holds the `ae_live_...` key server-side and forwards
 * the signaling. These shapes describe the proxy's signaling endpoints
 * (`/sessions`, `/sessions/:id/offer`, `/sessions/:id/ice`).
 */

/** ICE configuration returned by `/connect`, passed straight to RTCPeerConnection. */
export interface IceConfig {
  iceServers: RTCIceServer[]
}

/** Response of `POST /sessions { agent_id }`. `session_id == conversation_id`. */
export interface ConnectResponse {
  session_id: string
  ice_config: IceConfig
}

/** Response of `POST /sessions/:id/offer`. */
export interface OfferResponse {
  sdp: string
  type: "answer"
  pc_id: string
}

/**
 * ICE candidate payload for the signaling endpoint. Field names are
 * **snake_case** (`sdp_mid`, `sdp_mline_index`) — send them exactly as named.
 */
export interface IceCandidatePayload {
  candidate: string
  sdp_mid: string
  sdp_mline_index: number
}

/**
 * High-level call lifecycle, independent of the raw RTCPeerConnectionState.
 * `idle → connecting → connected → ended | error`.
 */
export type CallStatus = "idle" | "connecting" | "connected" | "ended" | "error"

/**
 * Messages received on the `chat` data channel. The only message type emitted
 * is `pipeline-metrics` (latencies, tokens, turn count, conversation state).
 * Live transcription is not delivered here — fetch the transcript after the call.
 */
export interface PipelineMetrics {
  type: "pipeline-metrics"
  [key: string]: unknown
}

/** Configurable endpoint paths on the proxy. Defaults match the reference Worker. */
export interface AethexEndpoints {
  /** POST — create a session. Default: `sessions`. */
  connect: string
  /** `:id`/`:sessionId` placeholders are substituted. Default: `sessions/:id/offer`. */
  offer: string
  /** Default: `sessions/:id/ice`. */
  ice: string
  /** Default: `sessions/:id/notify-ended`. */
  end: string
  /** GET — current server-side session status. Default: `sessions/:id/status`. */
  status: string
}

/**
 * Response of `GET /sessions/:id/status` — the server-side view of a session
 * (as opposed to the local `CallStatus`, which reflects the WebRTC state).
 * Field names match the API verbatim; extra fields are passed through.
 */
export interface SessionStatusResponse {
  session_id: string
  status: string
  /** Wall-clock duration in seconds. */
  duration_s?: number
  turn_count?: number
  agent_id?: string
  started_at?: string | null
  ended_at?: string | null
  [key: string]: unknown
}

/** Options shared by the transport and VoiceCall. */
export interface AethexCallConfig {
  /** UUID of the agent to call. */
  agentId: string
  /** Base URL of the **proxy** (never the direct API, never with an API key). */
  apiBaseUrl: string
  /** Override the signaling endpoint paths. */
  endpoints?: Partial<AethexEndpoints>
  /** Per-request timeout in ms for signaling fetches. Default 15000. */
  timeoutMs?: number
  /** Custom fetch implementation (tests / non-browser hosts). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Extra headers forwarded on signaling requests (e.g. a short-lived proxy token). */
  headers?: Record<string, string>
  /** Constraints for the local microphone. Sensible defaults applied if omitted. */
  audioConstraints?: MediaTrackConstraints
  /**
   * When an established call's peer connection reaches `failed`, attempt an ICE
   * restart — renegotiate via the offer endpoint with `restart_pc: true` —
   * before surfacing `peer_failed`. A transient `disconnected` is left to
   * self-heal (grace period) and never triggers a restart. **On by default**;
   * set `false` to fail fast instead. See `maxIceRestarts`.
   */
  iceRestart?: boolean
  /** Max consecutive ICE-restart attempts before giving up. Default 1. */
  maxIceRestarts?: number
}
