// Read-only check of the PUBLIC settings of a Citykart Desk login service.
//   node scripts/check-auth-settings.mjs <login-service-url> <public (anon) key>
//   e.g. node scripts/check-auth-settings.mjs http://10.0.1.98:8443 <NEXT_PUBLIC_SUPABASE_ANON_KEY>
// It sends ONE GET request to <url>/auth/v1/settings (an endpoint every browser can already call) and prints whether self sign-up is switched off.
// It changes nothing. The assessment never runs it against production: the owner runs it (VAPT-023).
import { argv, exit } from 'node:process'

const [url, key] = argv.slice(2)
if (!url || !key) { console.error('usage: node scripts/check-auth-settings.mjs <login-service-url> <public key>'); exit(2) }

const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key } })
if (!res.ok) { console.error(`The login service answered ${res.status}.`); exit(2) }
const settings = await res.json()

// same rules as lib/auth/settings-check.ts (kept inline so this script runs without a build)
const external = Object.entries(settings.external ?? {}).filter(([k, v]) => v && k !== 'email' && k !== 'phone').map(([k]) => k)
const findings = [
  { ok: settings.disable_signup === true, text: settings.disable_signup === true ? 'Self sign-up is switched off.' : 'Self sign-up is ON: anyone holding the public key can create an account. Set GOTRUE_DISABLE_SIGNUP=true.' },
  { ok: external.length === 0, text: external.length === 0 ? 'No social/OAuth sign-in providers are enabled.' : `Sign-in providers enabled: ${external.join(', ')}.` },
]
for (const f of findings) console.log(`${f.ok ? 'OK  ' : 'FAIL'}  ${f.text}`)
console.log('(The minimum password length is not published by the service: confirm GOTRUE_PASSWORD_MIN_LENGTH=10 (the application checks 10 characters and 3 of 4 kinds for new passwords) in its configuration file.)')
exit(findings.every((f) => f.ok) ? 0 : 1)
