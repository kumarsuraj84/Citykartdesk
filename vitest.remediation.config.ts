import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Post-audit remediation tests. Same as vitest.config.ts, but every file first passes the audit-only guard (tests/setup/audit-only.ts).
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/remediation/**/*.test.ts', 'tests/remediation/**/*.test.tsx'],
    setupFiles: ['tests/setup/audit-only.ts', 'tests/setup/env.ts'],
    testTimeout: 60_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
