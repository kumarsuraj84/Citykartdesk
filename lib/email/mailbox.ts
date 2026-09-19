import { createAdminClient } from '@/lib/supabase/admin'
import type { SmtpConfig } from './config'

// Server-only. Reads the mailbox saved under Admin > Platform Settings (see migration
// 142): host / port / mailbox address from email_smtp_settings, and the password from
// the encrypted Vault through a service_role-only RPC. Nothing here is ever sent to a
// browser except the non-secret fields via readMailboxForAdmin().

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any }

const CACHE_MS = 30_000
let cache: { expiresAt: number; value: SmtpConfig | null } | null = null

/** Call after any save/clear so the change applies to the very next email. */
export function invalidateMailboxCache(): void {
  cache = null
}

type Row = { host: string; port: number; username: string | null }

async function readRow(admin: AnyClient): Promise<Row | null> {
  const { data } = await admin.from('email_smtp_settings').select('host, port, username').maybeSingle()
  return (data as Row | null) ?? null
}

/** The saved mailbox as a ready-to-use SMTP config, or null when none is saved. */
export async function loadDbSmtpConfig(): Promise<SmtpConfig | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.value

  let value: SmtpConfig | null = null
  try {
    const admin = createAdminClient() as unknown as AnyClient
    const row = await readRow(admin)
    if (row?.host) {
      let pass: string | null = null
      if (row.username) {
        const { data } = await admin.rpc('email_smtp_read_password')
        pass = typeof data === 'string' && data.length > 0 ? data : null
      }
      value = {
        host: row.host,
        port: row.port,
        secure: row.port === 465,
        user: row.username || null,
        pass,
        fromAddress: null,
      }
    }
  } catch {
    // Database unreachable, or migration 142 not applied on this server yet: behave as
    // "nothing saved" (the server-file settings / Resend still work) rather than break sending.
    return null
  }

  cache = { expiresAt: Date.now() + CACHE_MS, value }
  return value
}

export type MailboxForAdmin = {
  host: string
  port: number
  username: string
  hasPassword: boolean
}

/** Non-secret view for the Settings screen. The password itself is never returned. */
export async function readMailboxForAdmin(): Promise<MailboxForAdmin | null> {
  try {
    const admin = createAdminClient() as unknown as AnyClient
    const row = await readRow(admin)
    if (!row) return null
    const { data } = await admin.rpc('email_smtp_has_password')
    return { host: row.host, port: row.port, username: row.username ?? '', hasPassword: data === true }
  } catch {
    return null
  }
}
