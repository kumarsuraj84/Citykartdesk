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
    setupFiles: ['tests/setup/env.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
