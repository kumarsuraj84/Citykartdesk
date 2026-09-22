import { createAdminClient } from '@/lib/supabase/admin'
import { loadDbSmtpConfig } from './mailbox'
import { isGmailHost } from './thread-tag'
import { findTaggedRequestNo, resolveKnownSender } from './inbound-match'
import { stripQuotedReply } from './quote-strip'
import { appendEmailReplyComment } from '@/lib/requests/email-reply-comment'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { listUsers: (opts: { page: number; perPage: number }) => any } } }

// How far back to look every run. Combined with the processed_inbound_emails dedupe table
// (unique on Message-ID), re-scanning this window every run is what makes this correct
// without needing to track IMAP UIDs/state across runs — a run that's late, retried, or
// overlaps the previous one just re-finds the same messages and skips them.
const LOOKBACK_DAYS = 3

export type InboundSyncResult = {
  skipped?: string
  checked: number
  matched: number
  noMatch: number
  senderNotRecognized: number
  errors: string[]
}

async function orgIdentityMaps(admin: AnyClient, orgId: string) {
  const [{ data: profiles }, { data: oems }] = await Promise.all([
    admin.from('profiles').select('id, full_name').eq('org_id', orgId).eq('is_active', true),
    admin.from('oems').select('name, emails').eq('org_id', orgId),
  ])
  const profileIds = new Set((profiles ?? []).map((p: { id: string }) => p.id))
  const nameById = new Map<string, string>(
    (profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]),
  )

  const profilesByEmail = new Map<string, { id: string; name: string }>()
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    const users = (data?.users ?? []) as { id: string; email?: string }[]
    if (users.length === 0) break
    for (const u of users) {
      if (u.email && profileIds.has(u.id)) {
        profilesByEmail.set(u.email.toLowerCase(), { id: u.id, name: nameById.get(u.id) ?? u.email })
      }
    }
    if (users.length < 1000) break
  }

  const oemNameByEmail = new Map<string, string>()
  for (const oem of (oems ?? []) as { name: string; emails: string[] }[]) {
    for (const email of oem.emails ?? []) oemNameByEmail.set(email.toLowerCase(), oem.name)
  }

  return { profilesByEmail, oemNameByEmail }
}

function addressText(value: unknown): string {
  // mailparser's AddressObject | AddressObject[] | undefined — normalized to a plain string.
  const v = value as { text?: string } | { text?: string }[] | undefined
  if (!v) return ''
  if (Array.isArray(v)) return v.map((x) => x.text ?? '').join(', ')
  return v.text ?? ''
}

function splitAddresses(text: string): string[] {
  return text.split(',').map((s) => {
    const m = /<([^>]+)>/.exec(s)
    return (m ? m[1] : s).trim()
  }).filter(Boolean)
}

/**
 * Polls the configured mailbox for replies to our own outbound ticket emails (tagged per
 * lib/email/thread-tag.ts) and adds each one to the matching ticket's conversation.
 * Only works for a Gmail-hosted mailbox (the only inbound method available with just the
 * SMTP App Password already saved — no separate OAuth/Pub-Sub setup needed). Safe to call
 * on a schedule; every email is deduped by its own Message-ID (processed_inbound_emails),
 * so an overlapping or re-run pass never double-posts the same reply.
 */
export async function syncInboundReplies(): Promise<InboundSyncResult> {
  const result: InboundSyncResult = { checked: 0, matched: 0, noMatch: 0, senderNotRecognized: 0, errors: [] }

  const config = await loadDbSmtpConfig()
  if (!config?.user || !config.pass) return { ...result, skipped: 'No mailbox configured.' }
  if (!isGmailHost(config.host)) return { ...result, skipped: 'Inbound reply sync only supports a Gmail-hosted mailbox.' }

  const admin = createAdminClient() as unknown as AnyClient
  const identityCache = new Map<string, Awaited<ReturnType<typeof orgIdentityMaps>>>()

  // Loaded dynamically rather than statically imported: imapflow pulls in pino for
  // logging, and a static top-level import of either drags both into Next's build-time
  // module graph, where Turbopack's standalone output has a real bug compiling that
  // exact combination (a bundled importer reaching into pino, which Next externalizes
  // by default — the compiled chunk ends up requiring a hashed alias like
  // "pino-28069d5257187539" that has no corresponding file anywhere in the standalone
  // bundle, taking down every route that shares that server chunk, not just this one).
  // A dynamic import resolves at runtime through plain Node module resolution instead.
  const [{ ImapFlow }, { simpleParser }] = await Promise.all([import('imapflow'), import('mailparser')])

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
      const uids = await client.search({ since }, { uid: true })
      if (!uids || uids.length === 0) return result

      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true })
          if (!msg || !msg.source) continue
          const parsed = await simpleParser(msg.source)
          const messageId = parsed.messageId ?? `<no-id-${uid}@imap>`

          const { data: already } = await admin.from('processed_inbound_emails').select('id').eq('message_id', messageId).maybeSingle()
          if (already) continue

          result.checked++
          const subject = parsed.subject ?? ''
          const fromAddress = addressText(parsed.from).match(/<([^>]+)>/)?.[1] ?? addressText(parsed.from)
          const toAddresses = [...splitAddresses(addressText(parsed.to)), ...splitAddresses(addressText(parsed.cc))]

          const requestNo = findTaggedRequestNo({ subject, toAddresses, fromAddress })
          if (!requestNo) {
            result.noMatch++
            await admin.from('processed_inbound_emails').insert({ message_id: messageId, outcome: 'no_match', from_address: fromAddress })
            continue
          }

          const { data: request } = await admin.from('requests').select('id, org_id').eq('request_no', requestNo).maybeSingle()
          if (!request?.org_id) {
            result.noMatch++
            await admin.from('processed_inbound_emails').insert({ message_id: messageId, outcome: 'no_match', from_address: fromAddress })
            continue
          }

          let maps = identityCache.get(request.org_id)
          if (!maps) { maps = await orgIdentityMaps(admin, request.org_id); identityCache.set(request.org_id, maps) }
          const sender = resolveKnownSender(fromAddress, maps.profilesByEmail, maps.oemNameByEmail)

          if (sender.kind === 'unknown') {
            result.senderNotRecognized++
            await admin.from('processed_inbound_emails').insert({ message_id: messageId, request_id: request.id, outcome: 'sender_not_recognized', from_address: fromAddress })
            try {
              const { recordEvents } = await import('@/lib/events/record')
              await recordEvents(
                [{ kind: 'system', target: fromAddress, message: `Reply to ${requestNo} from an unrecognized address was not added to the conversation.` }],
                { orgId: request.org_id, userId: null },
              )
            } catch { /* logging must never break the sync */ }
            continue
          }

          const rawBody = parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : '')
          const body = stripQuotedReply(rawBody)
          if (!body.trim()) {
            result.noMatch++
            await admin.from('processed_inbound_emails').insert({ message_id: messageId, request_id: request.id, outcome: 'no_match', from_address: fromAddress })
            continue
          }

          const author =
            sender.kind === 'profile'
              ? { kind: 'profile' as const, profileId: sender.profileId, name: sender.name }
              : { kind: 'oem' as const, name: sender.name, email: fromAddress }

          const appendResult = await appendEmailReplyComment({ requestId: request.id, body, author })
          if (appendResult.error) result.errors.push(appendResult.error)
          else result.matched++

          await admin.from('processed_inbound_emails').insert({ message_id: messageId, request_id: request.id, outcome: 'matched', from_address: fromAddress })
        } catch (e) {
          result.errors.push(e instanceof Error ? e.message : String(e))
        }
      }
    } finally {
      lock.release()
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.logout() } catch { /* already disconnected */ }
  }

  return result
}
