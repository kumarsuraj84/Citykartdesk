// Checks done once when the server starts (instrumentation.ts). They only WARN, in plain words, and never stop the server: a missing optional secret
// switches one feature off, and a wrong time zone is wrong but not fatal. No secret value is ever printed or returned; only names and what is wrong.
import { auditSecrets } from '@/lib/secrets'

export const EXPECTED_TIME_ZONE = 'Asia/Kolkata'
const KOLKATA_NAMES = new Set(['Asia/Kolkata', 'Asia/Calcutta'])   // the same zone under its old name

/** The sentences to log at start-up. `timeZone` is what the running process really uses (not just what TZ says). */
export function startupWarnings(env: Record<string, string | undefined> = process.env, timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string[] {
  const out: string[] = []
  if (!KOLKATA_NAMES.has(timeZone)) {
    out.push(`The server's time zone is "${timeZone}", not ${EXPECTED_TIME_ZONE} (TZ=${env.TZ ?? 'not set'}). Business hours, SLA clocks, daily digests and the cron day/hour gates would be wrong. Set TZ=${EXPECTED_TIME_ZONE} in .env.local and restart.`)
  }
  for (const i of auditSecrets(env)) {
    out.push(i.purpose === 'fallback'
      ? `${i.env}: ${i.problem}.`
      : `${i.env} is ${i.problem}${i.problem === 'not set' ? ` — whatever needs the ${i.purpose.replace(/_/g, ' ')} secret is switched off` : ''}.`)
  }
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? 0)
  if (!Number.isInteger(hops) || hops < 1) {
    out.push('TRUSTED_PROXY_HOPS is not set: the caller\'s address is unknown, so per-address limits are off and sign-in lockouts rest on the account only. Set it to 1 when one reverse proxy is in front of the app.')
  }
  return out
}

