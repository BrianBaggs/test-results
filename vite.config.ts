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
    plugins: [
      react(),
      publishPlugin({ webhookUrl: env.SLACK_WEBHOOK_URL }),
      // Review tab: runs local git (and the Atlassian CLI) from the dev server.
      reviewPlugin({
        repoPath: env.REVIEW_REPO_PATH,
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
