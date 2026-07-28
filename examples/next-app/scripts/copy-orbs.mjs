// Copies the orb video clips shipped inside @aethexai/react into this app's
// public/ folder so Next.js can serve them. Run automatically on predev /
// prebuild. This is how a real consumer would surface the packaged assets:
// resolve them from the installed package, then serve/bundle with their own app.
import { mkdir, copyFile, access } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const CLIPS = ["orb-green.webm", "orb-magenta.webm"]
const OUT_DIR = join(process.cwd(), "public", "orbs")

// Resolve the package root via its package.json, then read its shipped assets.
const pkgRoot = dirname(require.resolve("@aethexai/react/package.json"))
const assetDir = join(pkgRoot, "dist", "assets")

await mkdir(OUT_DIR, { recursive: true })
for (const clip of CLIPS) {
  const src = join(assetDir, clip)
  try {
    await access(src)
  } catch {
    console.error(`[copy-orbs] Missing ${src}. Build the SDK first (npm run build in the repo root).`)
    process.exit(1)
  }
  await copyFile(src, join(OUT_DIR, clip))
  console.log(`[copy-orbs] ${clip} -> public/orbs/`)
}
