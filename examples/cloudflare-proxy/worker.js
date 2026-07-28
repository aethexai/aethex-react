/**
 * Aethex signaling proxy — Cloudflare Worker (signaling-only).
 *
 * Why a proxy: the `ae_live_...` API key must NEVER reach the browser. The SDK
 * (`useAethexCall` / `VoiceCall`) points its `apiBaseUrl` here; this Worker holds
 * the key as a secret, validates input, and forwards SDP + ICE to the Aethex API.
 * Media (audio) flows peer-to-peer/TURN after the ~1-3s handshake — it never
 * transits the Worker.
 *
 * Minimal, signaling-only: it implements just the routes the SDK calls
 * (sessions / offer / ice / status / notify-ended / transcript) and forwards
 * each to the matching Aethex API route with the key attached. `offer` forwards
 * the body verbatim, so an ICE restart (`restart_pc: true`, with the existing
 * `pc_id`) works without special handling.
 *
 * Secrets / vars (see .dev.vars.example and wrangler.toml):
 *   AETHEX_API_KEY    (secret)  — API key with the calls scope
 *   AETHEX_BASE_URL   (var)     — the Aethex API base URL
 *   ALLOWED_ORIGINS   (var)     — comma-separated origins for CORS, or "*"
 *   ALLOWED_AGENT_IDS (var)     — optional comma-separated UUID allowlist
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Generous cap for SDP/ICE bodies; rejects abusive payloads early.
const MAX_BODY_BYTES = 256 * 1024

// Early-ICE buffer. The browser trickles ICE candidates as soon as it gathers
// them — before the offer answer brings `pc_id`. The /ice endpoint requires
// `pc_id`, so we can't forward those early candidates yet. We park them here and
// drain them upstream the instant `pc_id` is known (on the offer answer, or a
// later PATCH that carries pc_id). Forwarding candidates as early as possible is
// what lets slow gatherers — e.g. a browser behind a symmetric NAT (TURN-only) —
// connect in time.
//
// NOTE: these Maps live in module (isolate) memory — fine for `wrangler dev`
// (single isolate). In production, multiple isolates mean a request may not see
// another's buffer; use a Durable Object keyed by session_id instead. Entries
// are released on notify-ended so abandoned sessions don't leak.
const iceBuffer = new Map() // session_id -> candidate[]  (pre-pc_id candidates)
const pcIdBySession = new Map() // session_id -> pc_id  (lets late null-pc_id PATCHes forward)

function bufferIce(sessionId, candidates) {
  const arr = iceBuffer.get(sessionId) ?? []
  for (const c of candidates) arr.push(c)
  iceBuffer.set(sessionId, arr)
  return arr.length
}

function drainIce(sessionId) {
  const arr = iceBuffer.get(sessionId) ?? []
  iceBuffer.delete(sessionId)
  return arr
}

async function flushBufferedIce(env, sessionId, pcId) {
  const drained = drainIce(sessionId)
  if (drained.length === 0) return
  await upstream(env, "PATCH", `/api/v1/conversation/${enc(sessionId)}/ice`, {
    pc_id: pcId,
    candidates: drained,
  })
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   */
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get("Origin") || ""
    const cors = corsHeaders(origin, env)

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      const res = await route(request, url, env)
      // Merge CORS headers onto whatever the handler returned.
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(cors)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    } catch (err) {
      // Log server-side; never leak internal error details (infra host, etc.).
      console.error("proxy_error", err)
      return json({ error: "proxy_error" }, 502, cors)
    }
  },
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {Record<string, string>} env
 */
async function route(request, url, env) {
  const { pathname } = url
  const method = request.method

  // POST /sessions  →  connect
  if (pathname === "/sessions" && method === "POST") {
    const body = await safeJson(request)
    const agentId = body?.agent_id
    if (typeof agentId !== "string" || !UUID_RE.test(agentId)) {
      return json({ error: "invalid_agent_id" }, 400)
    }
    if (!isAllowedAgent(agentId, env)) {
      return json({ error: "agent_not_allowed" }, 403)
    }
    return upstream(env, "POST", "/api/v1/conversation/connect", { agent_id: agentId })
  }

  // POST /sessions/:id/offer
  const offer = match(pathname, /^\/sessions\/([^/]+)\/offer$/)
  if (offer && method === "POST") {
    if (!UUID_RE.test(offer)) return json({ error: "invalid_session_id" }, 400)
    if (tooLarge(request)) return json({ error: "payload_too_large" }, 413)
    const res = await upstream(
      env,
      "POST",
      `/api/v1/conversation/${enc(offer)}/offer`,
      await safeJson(request),
    )
    // Read the answer to learn pc_id, then drain any candidates the browser
    // trickled in before pc_id existed — upstream, right now — so the server
    // can start connectivity checks the moment it applies the answer.
    const text = await res.text()
    let pcId = null
    try {
      pcId = JSON.parse(text)?.pc_id ?? null
    } catch {
      /* non-JSON (error) body — nothing to drain against */
    }
    if (pcId) {
      pcIdBySession.set(offer, pcId)
      // Best-effort: a drain failure must NOT fail an otherwise-valid answer.
      await flushBufferedIce(env, offer, pcId).catch(() => {})
    }
    return new Response(text, { status: res.status, headers: res.headers })
  }

  // PATCH /sessions/:id/ice
  const ice = match(pathname, /^\/sessions\/([^/]+)\/ice$/)
  if (ice && method === "PATCH") {
    if (!UUID_RE.test(ice)) return json({ error: "invalid_session_id" }, 400)
    if (tooLarge(request)) return json({ error: "payload_too_large" }, 413)
    const body = await safeJson(request)
    const candidates = Array.isArray(body?.candidates) ? body.candidates : []
    // Use the request's pc_id, or one learned earlier from the offer answer — so
    // a late candidate arriving with pc_id:null after the offer already drained
    // is still forwarded rather than stranded in the buffer.
    const pcId = body?.pc_id ?? pcIdBySession.get(ice) ?? null
    if (!pcId) {
      // pc_id unknown yet — Aethex would reject this. Buffer + ack (202); these
      // drain on the offer answer or a later PATCH that carries pc_id.
      const buffered = bufferIce(ice, candidates)
      return json({ status: "buffered", buffered }, 202)
    }
    pcIdBySession.set(ice, pcId)
    // pc_id known — combine anything buffered earlier with this batch.
    const combined = drainIce(ice).concat(candidates)
    return upstream(env, "PATCH", `/api/v1/conversation/${enc(ice)}/ice`, {
      pc_id: pcId,
      candidates: combined,
    })
  }

  // GET /sessions/:id/status  →  server-side session status
  const status = match(pathname, /^\/sessions\/([^/]+)\/status$/)
  if (status && method === "GET") {
    if (!UUID_RE.test(status)) return json({ error: "invalid_session_id" }, 400)
    return upstream(env, "GET", `/api/v1/conversation/${enc(status)}/status`, null)
  }

  // POST /sessions/:id/notify-ended  (best-effort)
  const ended = match(pathname, /^\/sessions\/([^/]+)\/notify-ended$/)
  if (ended && method === "POST") {
    if (!UUID_RE.test(ended)) return json({ error: "invalid_session_id" }, 400)
    // Release per-session state so abandoned / failed sessions can't leak.
    iceBuffer.delete(ended)
    pcIdBySession.delete(ended)
    return upstream(env, "POST", `/api/v1/conversation/${enc(ended)}/end`, {})
  }

  // GET /conversations/:id/transcript  (post-call)
  const transcript = match(pathname, /^\/conversations\/([^/]+)\/transcript$/)
  if (transcript && method === "GET") {
    if (!UUID_RE.test(transcript)) return json({ error: "invalid_session_id" }, 400)
    // NOTE: transcript is plural (`conversations`) and versioned, unlike the
    // singular `/api/v1/conversation/...` signaling routes above.
    return upstream(env, "GET", `/api/v1/conversations/${enc(transcript)}/transcript`, null)
  }

  return json({ error: "not_found" }, 404)
}

/**
 * Forward a request to the Aethex API with the secret key attached.
 * @param {Record<string,string>} env
 * @param {string} method
 * @param {string} path
 * @param {unknown} body
 */
async function upstream(env, method, path, body) {
  const base = (env.AETHEX_BASE_URL || "").replace(/\/$/, "")
  const init = {
    method,
    headers: {
      "X-API-Key": env.AETHEX_API_KEY,
      Accept: "application/json",
      // `wrangler dev` (local workerd) sends no User-Agent on outbound fetch,
      // which some upstream WAFs reject with a 403. Set one explicitly so local
      // dev matches deployed behaviour (deployed Workers send "Cloudflare-Workers").
      "User-Agent": "aethex-signaling-proxy",
    },
  }
  if (body !== null && method !== "GET") {
    init.headers["Content-Type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${base}${path}`, init)
  // Pass status + body through verbatim so the SDK can map 402/429/503 etc.
  const headers = new Headers()
  const ct = res.headers.get("Content-Type")
  if (ct) headers.set("Content-Type", ct)
  const retryAfter = res.headers.get("Retry-After")
  if (retryAfter) headers.set("Retry-After", retryAfter)
  return new Response(res.body, { status: res.status, headers })
}

// ── helpers ──────────────────────────────────────────────────────────────────

function match(pathname, re) {
  const m = re.exec(pathname)
  return m ? m[1] : null
}

function enc(id) {
  return encodeURIComponent(id)
}

function tooLarge(request) {
  const len = Number(request.headers.get("Content-Length") || 0)
  return Number.isFinite(len) && len > MAX_BODY_BYTES
}

async function safeJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function isAllowedAgent(agentId, env) {
  const list = (env.ALLOWED_AGENT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length === 0 || list.includes(agentId)
}

function json(obj, status, extraHeaders) {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
  return new Response(JSON.stringify(obj), { status, headers })
}

function corsHeaders(origin, env) {
  // Secure by default: no ALLOWED_ORIGINS → emit NO Access-Control-Allow-Origin
  // (the browser blocks). Never reflect an arbitrary/non-allowed origin.
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
  if (allowed.includes("*")) {
    headers["Access-Control-Allow-Origin"] = "*" // dev only
  } else if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
  }
  return headers
}
