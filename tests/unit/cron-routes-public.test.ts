import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Every scheduled job calls its route with the shared secret and NO sign-in. A route that is not in the proxy's public list is answered with a redirect to the
// login page (HTTP 200 for the job runner), so the job would "succeed" every time and do nothing. This keeps the job list and the public list in step.
describe('scheduled job routes are reachable without a session', () => {
  const tick = readFileSync('scripts/cron-tick.mjs', 'utf8')
  const proxy = readFileSync('proxy.ts', 'utf8')
  const block = /const JOB_PATHS = \{([\s\S]*?)\n\}/.exec(tick)
  const paths = [...(block?.[1] ?? '').matchAll(/:\s*'(\/api\/[^']+)'/g)].map((m) => m[1])

  it('finds the job list', () => { expect(paths.length).toBeGreaterThanOrEqual(7); expect(paths).toContain('/api/approvals/reminders') })
  it.each(paths)('%s is in the proxy\'s public routes', (path) => {
    expect(proxy).toContain(`'${path}'`)
  })
})
