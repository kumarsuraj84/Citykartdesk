import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests hit the local Supabase Postgres/Auth instance directly
    // (real RLS, real triggers) — see tests/setup/env.ts. They are not safe to
    // run concurrently against shared fixtures, so keep this file-serial.
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The remediation tests change data in the disposable audit database; they run only through vitest.remediation.config.ts
    // (which refuses anything but the audit stack), never in the default run against the developer database.
    exclude: ['**/node_modules/**', 'tests/remediation/**'],
    setupFiles: ['tests/setup/env.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/setup/server-only-stub.ts'),
    },
  },
})
