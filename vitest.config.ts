import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/react/**", "src/widgets/**"],
      // Barrels and type-only modules carry no runtime code to exercise; the
      // vendored canvas fingerprint renderer needs a real 2D context (not jsdom).
      exclude: ["**/index.ts", "src/core/types.ts", "src/widgets/voiceVisual/renderer.ts"],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
})
