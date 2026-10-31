// Helpers of the local demo runs. LOCAL ONLY: they sign in as an existing local person WITHOUT their password (a one-time link of the local login service), so nobody's
// password is needed or changed, and they only ever talk to the local database (scripts/local-demo/setup.ts guards that).
import fs from 'node:fs'
import path from 'node:path'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { getAdmin, clientForToken } from '../../tests/setup/fixtures-d03'

export { getAdmin, clientForToken }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = () => getAdmin() as any

/** An access token for this existing person (local login service only). */
export async function tokenFor(email: string): Promise<string> {
  const admin = getAdmin()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.properties?.hashed_token) throw new Error(`could not sign in as ${email}: ${error?.message ?? 'no link'}`)
  const anon = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2 || !s.session) throw new Error(`could not sign in as ${email}: ${e2?.message ?? 'no session'}`)
  return s.session.access_token
}

/** The mails saved so far (the local mail sink: one file per mail). */
export function sinkFiles(): string[] {
  const dir = path.resolve(process.cwd(), process.env.MAIL_SINK_DIR ?? 'local-mail-outbox')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)) : []
}
export function newMailsSince(before: string[]): { file: string; to: string; cc: string; subject: string; text: string }[] {
  const old = new Set(before)
  return sinkFiles().filter((f) => !old.has(f)).map((file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))
    return { file, to: list(m.to), cc: list(m.cc), subject: String(m.subject ?? ''), text: String(m.text ?? m.html ?? '') }
  })
}
