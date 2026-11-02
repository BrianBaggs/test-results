import { fileURLToPath } from 'node:url'
import { defineConfig, coverageConfigDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Silences only the "jsdom was created N times" hint. Its suggested alternatives don't fit
    // this suite: `pool: 'vmThreads'` breaks tests (globals such as ReadableStream are missing and
    // window.location can't be redefined), and `isolate: false` breaks them too (DOM and mocks leak
    // from one file into the next). Per-file jsdom setup is the cost of isolated DOM tests.
    experimental: {
      diagnostics: {
        environment: false
      }
    },
    // server/**  tests live alongside their source rather than under src/test/ —
    // they belong to the separate tsconfig.node.json TS project, and importing
    // them from a src/ file trips TS6305 (see tsconfig.json's project reference).
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'coverage/**',
        // vitest's own sensible defaults (test files, type declarations, config files, etc.)
        ...coverageConfigDefaults.exclude,
        // Vendored shadcn/ui primitives (generated boilerplate, not hand-written business logic)
        'src/components/ui/**'
      ],
      thresholds: {
        global: {
          branches: 90,
          functions: 92,
          lines: 95,
          statements: 93
        }
      }
    }
  }
})
