import { NextResponse } from "next/server"

// Same-origin backend for the demo. It does two jobs:
//   1. Mints ephemeral call tokens (POST /api/aethex/conversation/token) using
//      your API key — this is the only thing that needs the key server-side.
//   2. Forwards the rest of the signaling. If the browser already sent a call
//      token (Authorization: Bearer …), it passes that through so the demo
//      exercises the real token-auth path; otherwise it attaches the key.
//
// Why route signaling through here at all, when tokens are meant to skip the
// proxy? Only to dodge CORS during LOCAL testing: the browser and this route are
// same-origin. In production, allow-list your app's origin on the Aethex API and
// drop `apiBaseUrl` in the client so the app talks to the API directly.

export const runtime = "nodejs"

const API = (process.env.AETHEX_API_BASE ?? "https://api.aethexai.com/api/v1").replace(/\/$/, "")

async function proxy(req: Request, { params }: { params: { path: string[] } }) {
  const key = process.env.AETHEX_API_KEY
  if (!key) {
    return NextResponse.json({ error: "AETHEX_API_KEY is not set in .env.local" }, { status: 500 })
  }

  const path = params.path.join("/")
  const search = new URL(req.url).search
  const incomingAuth = req.headers.get("authorization")

  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
  }
  // Minting a token needs the API key. Everything else uses the caller's bearer
  // token when present (the real token-auth path), falling back to the key.
  if (incomingAuth && path !== "conversation/token") {
    headers.Authorization = incomingAuth
  } else {
    headers["X-API-Key"] = key
  }

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text()
  const res = await fetch(`${API}/${path}${search}`, { method: req.method, headers, body })

  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  })
}

export { proxy as GET, proxy as POST, proxy as PATCH }
