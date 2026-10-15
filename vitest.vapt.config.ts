import { defineConfig } from 'vitest/config'
import path from 'node:path'

// VAPT 2026-10 exploit and regression tests. Same as vitest.config.ts, but every file first passes the audit-only guard (tests/setup/audit-only.ts).
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/vapt/**/*.test.ts', 'tests/vapt/**/*.test.tsx'],
    setupFiles: ['tests/setup/audit-only.ts', 'tests/setup/env.ts'],
    testTimeout: 60_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.'), 'server-only': path.resolve(__dirname, 'tests/setup/server-only-stub.ts') } },
})
