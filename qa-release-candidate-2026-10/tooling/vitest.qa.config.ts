import { defineConfig } from 'vitest/config'
import path from 'node:path'

// QA run configuration (local only). Same as the project's own configs, but it can run the UNIT and INTEGRATION suites too, and every file first passes the audit-only
// guard (tests/setup/audit-only.ts): it refuses to start unless the isolated audit stack (API port 554xx) and the egress guard are active. So these suites can never
// touch the developer database (which holds production-derived data) even by accident.
// Run it only through: bash security-assessment-2026-10/07-FINAL-REMEDIATION/tools/run-suite.sh <log> --config qa-release-candidate-2026-10/tooling/vitest.qa.config.ts <files>
const root = path.resolve(__dirname, '..', '..')
export default defineConfig({
  root,
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts', 'tests/integration/**/*.test.tsx', 'tests/vapt/**/*.test.ts', 'tests/vapt/**/*.test.tsx', 'tests/remediation/**/*.test.ts', 'tests/remediation/**/*.test.tsx', 'qa-release-candidate-2026-10/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['tests/setup/audit-only.ts', 'tests/setup/env.ts'],
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
  resolve: { alias: { '@': root, 'server-only': path.resolve(root, 'tests/setup/server-only-stub.ts') } },
})
