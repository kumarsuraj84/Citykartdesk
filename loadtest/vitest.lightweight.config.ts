import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Dedicated config for concurrent-runner.worker.ts - the lightweight,
// single-process load driver (see that file's header comment for why).
// pool: 'threads' + singleThread: true keeps this to ONE OS process for
// the whole run, regardless of how many concurrent personas it drives
// internally via AsyncLocalStorage + Promise-pool concurrency - the
// opposite of loadtest/vitest.config.ts's one-process-per-shard model,
// which is what made the load generator itself the dominant CPU consumer
// in the 2026-09-16 target-scale test (312.89 vs 71.68 CPU-seconds).
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 20 * 60_000,
    hookTimeout: 60_000,
    include: ['loadtest/workers/concurrent-runner.worker.ts'],
    setupFiles: ['loadtest/setup/env.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
})
