// VAPT-030: one secret per purpose; a missing one switches the feature off instead of borrowing another secret.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { getSecret, auditSecrets, MIN_SECRET_LENGTH } from '@/lib/secrets'

const KEYS = ['APPROVAL_LINK_SECRET', 'CSAT_LINK_SECRET', 'OAUTH_STATE_SECRET', 'INTAKE_WEBHOOK_TOKEN', 'INTAKE_WORKER_SECRET', 'SYSTEM_LOG_INGEST_SECRET', 'CRON_SECRET', 'ALLOW_SHARED_SECRET_FALLBACK']
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

describe('getSecret', () => {
  it('returns only the secret of that purpose; the cron secret is never borrowed', () => {
    process.env.CRON_SECRET = 'cron-secret-value-0123456789'
    for (const p of ['approval_link', 'csat_link', 'oauth_state', 'intake_webhook', 'intake_worker', 'system_log_ingest'] as const) expect(getSecret(p), p).toBeNull()
    expect(getSecret('cron')).toBe('cron-secret-value-0123456789')
    process.env.APPROVAL_LINK_SECRET = 'approval-secret-0123456789'
    expect(getSecret('approval_link')).toBe('approval-secret-0123456789')
    expect(getSecret('csat_link')).toBeNull()                                    // the approval secret does not sign rating links either
  })
  it('a blank value counts as not set', () => {
    process.env.OAUTH_STATE_SECRET = '   '
    expect(getSecret('oauth_state')).toBeNull()
  })
  it('the transitional switch lets purposes use the cron secret again, and only then', () => {
    process.env.CRON_SECRET = 'cron-secret-value-0123456789'
    process.env.ALLOW_SHARED_SECRET_FALLBACK = '1'
    expect(getSecret('intake_worker')).toBe('cron-secret-value-0123456789')
    process.env.ALLOW_SHARED_SECRET_FALLBACK = '0'
    expect(getSecret('intake_worker')).toBeNull()
  })
})

describe('auditSecrets', () => {
  it('reports missing, short and shared secrets and the transitional switch, never a value', () => {
    const issues = auditSecrets({ CRON_SECRET: 'same-value-same-value-1', APPROVAL_LINK_SECRET: 'same-value-same-value-1', CSAT_LINK_SECRET: 'short', ALLOW_SHARED_SECRET_FALLBACK: '1' })
    const text = JSON.stringify(issues)
    expect(text).not.toContain('same-value-same-value-1')
    expect(issues.find((i) => i.env === 'CSAT_LINK_SECRET')?.problem).toMatch(new RegExp(`shorter than ${MIN_SECRET_LENGTH}`))
    // the shared value is reported on whichever of the two is checked second
    expect(issues.some((i) => /same value as/.test(i.problem))).toBe(true)
    expect(issues.some((i) => i.env === 'OAUTH_STATE_SECRET' && i.problem === 'not set')).toBe(true)
    expect(issues.some((i) => i.purpose === 'fallback')).toBe(true)
  })
  it('a clean configuration has no issues', () => {
    const env: Record<string, string> = {}
    for (const k of KEYS.filter((k) => k !== 'ALLOW_SHARED_SECRET_FALLBACK')) env[k] = `${k.toLowerCase()}-long-unique-value-1234`
    expect(auditSecrets(env)).toEqual([])
  })
})

describe('no code path falls back to another purpose\'s secret', () => {
  const files = ['lib/approvals/email-link.ts', 'lib/csat/token.ts', 'lib/auth/verified-user.ts', 'lib/intake/oauth.ts', 'lib/actions/intake/channels.ts', 'lib/actions/intake/communication.ts',
    'lib/actions/intake/pipeline.ts', 'app/api/intake/cron/classify/route.ts', 'app/api/intake/webhook/gmail/route.ts', 'app/api/intake/webhook/outlook/route.ts', 'app/api/intake/oauth/callback/route.ts', 'app/api/system-log/ingest/route.ts']
  for (const f of files) {
    it(`${f} does not read CRON_SECRET or chain secrets with ??`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/process\.env\.CRON_SECRET/)
      expect(src).not.toMatch(/process\.env\.INTAKE_WORKER_SECRET\s*(\?\?|\|\|)/)
    })
  }
  it('the Outlook subscription address carries no secret', () => {
    expect(readFileSync('app/api/intake/oauth/callback/route.ts', 'utf8')).not.toMatch(/\/webhook\/outlook\?token=/)
  })
})
