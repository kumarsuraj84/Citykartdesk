import { defineConfig } from 'vitest/config'
import path from 'node:path'

// LOCAL DEMO runs (scripts/local-demo/*.demo.ts): they use the REAL actions of the app against the LOCAL developer database and LEAVE their results there
// (a moved category, a vendor company, a demo ticket), so they can be looked at in the local app. Run one with:
//   npx vitest run --config vitest.demo.config.ts scripts/local-demo/01-cutover-ac-genset.demo.ts
// scripts/local-demo/setup.ts refuses to run against anything that is not this PC. Mail is saved in local-mail-outbox/ (MAIL_SINK_DIR), never sent.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['scripts/local-demo/**/*.demo.ts'],
    setupFiles: ['scripts/local-demo/setup.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/setup/server-only-stub.ts'),
    },
  },
})
