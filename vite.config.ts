/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import IstanbulPlugin from 'vite-plugin-istanbul'
import { publishPlugin } from './server/publishPlugin.ts'
import { reviewPlugin } from './server/reviewPlugin.ts'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Empty prefix so SLACK_WEBHOOK_URL loads even though it isn't VITE_-prefixed.
  // It must stay out of import.meta.env — that would bundle the secret into
  // client-side JS — so it's read here and passed to the plugin instead.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      sourcemap: true
    },
    // Only for the Playwright server (playwright.config.ts sets E2E_COVERAGE). Coverage is added after the
    // JSX transform and mapped back to the .tsx through its source map. The dev-mode JSX transform adds
    // generated-only arguments (fileName, lineNumber, columnNumber) to every JSX call, and that makes the
    // mapping drop most statements: Feedback.tsx and badge.tsx were reported as 0% although the specs render
    // them. Plain JSX keeps the mapping intact. Normal `npm run dev` keeps dev-mode JSX, whose component
    // stacks make React warnings (invalid nesting, keys) point at the right component.
    oxc: process.env.E2E_COVERAGE ? { jsx: { development: false } } : undefined,
    plugins: [
      react(),
      publishPlugin({ webhookUrl: env.SLACK_WEBHOOK_URL }),
      // Review tab: runs local git (and the Atlassian CLI) from the dev server.
      reviewPlugin({
        repoPath: env.REVIEW_REPO_PATH,
        serverRepoPath: env.REVIEW_SERVER_REPO_PATH,
        testServerPort: Number(env.REVIEW_TEST_SERVER_PORT) > 0 ? Number(env.REVIEW_TEST_SERVER_PORT) : undefined,
        jira: {
          reviewStatus: env.JIRA_REVIEW_STATUS,
          doneStatus: env.JIRA_DONE_STATUS,
          baseUrl: env.JIRA_BASE_URL || 'https://securicyapp.atlassian.net'
        }
      }),
      IstanbulPlugin({
        include: 'src/*',
        exclude: ['node_modules', 'test/', 'src/test/**', '.history/**'],
        extension: ['.js', '.ts', '.tsx']
      })
    ]
    // Unit-test/coverage config lives in vitest.config.ts, which vitest prefers over
    // this file whenever both exist — a `test` block here would never actually run.
  }
})
