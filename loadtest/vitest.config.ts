import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Separate from the root vitest.config.ts on purpose: the regular suite runs
// files serially (fileParallelism: false) because its tests assume ownership
// of shared fixtures. The load-test harness is the opposite - it EXISTS to
// generate genuine concurrent load, so every worker file gets its own OS
// process (pool: 'forks') with fully isolated module state, safe to run in
// parallel. loadtest/run.mjs spawns one `vitest run` invocation per shard;
// this config's job is just to make each invocation itself safe and fast.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: true,
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: ['loadtest/workers/**/*.worker.ts'],
    setupFiles: ['loadtest/setup/env.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
})
