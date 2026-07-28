import { defineConfig, type Options } from "tsup"

const common: Options = {
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  external: ["react", "react-dom"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" }
  },
}

// esbuild strips module-level "use client" during bundling, so we prepend it
// AFTER the build (onSuccess) to the React-facing entries only. `core` stays
// directive-free so it remains usable from React Server Components.
const CLIENT_FILES = [
  "dist/index.js",
  "dist/index.cjs",
  "dist/react/index.js",
  "dist/react/index.cjs",
  "dist/widgets/index.js",
  "dist/widgets/index.cjs",
]

// Orb video clips shipped with the package (see the "./assets/*" export).
const ORB_ASSETS = ["orb-green.webm", "orb-magenta.webm"]

export default defineConfig([
  {
    ...common,
    entry: { "core/index": "src/core/index.ts" },
    clean: true,
  },
  {
    ...common,
    entry: {
      index: "src/index.ts",
      "react/index": "src/react/index.ts",
      "widgets/index": "src/widgets/index.ts",
    },
    clean: false,
    async onSuccess() {
      const { readFile, writeFile, mkdir, copyFile } = await import("node:fs/promises")
      for (const file of CLIENT_FILES) {
        const code = await readFile(file, "utf8")
        if (!code.startsWith('"use client"')) await writeFile(file, `"use client";\n${code}`)
      }
      // Ship the orb video assets with the package (exposed via the
      // "./assets/*" subpath export). Kept out of the JS bundle so the
      // widgets entry stays within its size budget.
      await mkdir("dist/assets", { recursive: true })
      for (const name of ORB_ASSETS) {
        await copyFile(`src/widgets/assets/${name}`, `dist/assets/${name}`)
      }
    },
  },
])
