import path from "node:path"
import { configDefaults, defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // The backend is its own workspace with a Node-only Vitest configuration.
  // Keeping its Fastify dependency graph out of frontend tests avoids cross-project resolution.
  // `e2e/**` holds Playwright `*.spec.ts` files, run only by `pnpm e2e`, never Vitest.
  test: {
    exclude: [...configDefaults.exclude, "server/**", "e2e/**"],
  },
  // React, React Router and the scheduler are the framework runtime behind every route, so they
  // are always in the entry graph and can never be lazy-loaded away. Splitting them out keeps the
  // app entry chunk under Rollup's 500 kB warning threshold and lets browsers reuse the cached
  // framework across app deploys.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return "react-runtime"
        },
      },
    },
  },
})
