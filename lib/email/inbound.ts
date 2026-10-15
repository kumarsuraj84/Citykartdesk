import { createAdminClient } from '@/lib/supabase/admin'
import { loadDbSmtpConfig } from './mailbox'
import { isGmailHost } from './thread-tag'
import { findTaggedRequestNo, isPlausibleSender, oemNameByDomain, resolveKnownSender, resolveOemByDomain } from './inbound-match'
import { htmlToPlainText } from './oem-template'
import { stripQuotedReply } from './quote-strip'
import { senderAddress } from './inbound-sender'
import { senderAuthenticity } from './inbound-auth'
import { postReplyOnce } from './inbound-claim'
import { appendEmailReplyComment } from '@/lib/requests/email-reply-comment'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { listUsers: (opts: { page: number; perPage: number }) => any } } }

// How far back to look every run. Combined with the processed_inbound_emails dedupe table
// (unique on Message-ID), re-scanning this window every run is what makes this correct
// without needing to track IMAP UIDs/state across runs — a run that's late, retried, or
// overlaps the previous one just re-finds the same messages and skips them.
const LOOKBACK_DAYS = 3
// One pass must finish well inside the scheduler's own limit (5 minutes): it stops starting new downloads after this long, and every network wait has a limit.
const SYNC_BUDGET_MS = 120_000
const ONE_BATCH = 200

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

  return { profilesByEmail, oemNameByEmail, oemNameByDomain: oemNameByDomain(oemNameByEmail) }
}

/**
 * A reply that was NOT added to the conversation leaves a short internal note on the ticket (staff only), so a technician can see that an answer
 * arrived and why it is not shown, instead of it vanishing silently. Only for senders at a company we actually deal with.
 */
async function noteUnaddedReply(admin: AnyClient, requestId: string, fromAddress: string, reason: string) {
  try {
    await admin.from('request_comments').insert({
      request_id: requestId, author_id: null, external_name: 'Citykart Desk', is_internal: true,
      body: `An e-mail reply to this ticket from ${fromAddress} was not added to the conversation: ${reason}. If it is genuine, copy the message in by hand.`,
    })
  } catch { /* a note must never break the sync */ }
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
    // the library waits up to 5 minutes on a connection that has gone quiet; a pass that stalls that long blocked the scheduled job until it timed out
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  })
  // last resort: if anything still hangs, drop the connection so the pass ends
  const watchdog = setTimeout(() => { try { client.close() } catch { /* already closed */ } }, SYNC_BUDGET_MS + 30_000)

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
      const uids = await client.search({ since }, { uid: true })
      if (!uids || uids.length === 0) return result

      // Which of these mails are new? Ask for the headers only (small), and download the full message just for the ones not handled before. The pass used to download
      // and read every mail of the last 3 days on every run (once a minute), which grew with the mailbox until a pass took minutes.
      const messageIdOf = new Map<number, string>()
      for await (const m of client.fetch(uids, { envelope: true, uid: true }, { uid: true })) {
        if (m.envelope?.messageId) messageIdOf.set(m.uid, m.envelope.messageId)
      }
      const handled = new Set<string>()
      const ids = [...new Set(messageIdOf.values())]
      for (let i = 0; i < ids.length; i += ONE_BATCH) {
        const { data } = await admin.from('processed_inbound_emails').select('message_id').in('message_id', ids.slice(i, i + ONE_BATCH))
        for (const r of (data ?? []) as { message_id: string }[]) handled.add(r.message_id)
      }
      const isHandled = (id: string) => handled.has(id) || handled.has(`<${id.replace(/^<|>$/g, '')}>`) || handled.has(id.replace(/^<|>$/g, ''))
      const fresh = uids.filter((uid) => { const id = messageIdOf.get(uid); return !id || !isHandled(id) })
      const deadline = Date.now() + SYNC_BUDGET_MS

      for (const uid of fresh) {
        if (Date.now() > deadline) break          // the rest waits for the next pass
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true })
          if (!msg || !msg.source) continue
          const parsed = await simpleParser(msg.source)
          const messageId = parsed.messageId ?? `<no-id-${uid}@imap>`

          const { data: already } = await admin.from('processed_inbound_emails').select('id').eq('message_id', messageId).maybeSingle()
          if (already) continue

          result.checked++
          const subject = parsed.subject ?? ''
          // the sender is read from the parsed header's structured field; a message without exactly one plain sender address is not trusted (D-057)
          const fromAddress = senderAddress(parsed.from) ?? ''
          if (!fromAddress) {
            result.noMatch++
            await admin.from('processed_inbound_emails').insert({ message_id: messageId, outcome: 'no_match', from_address: '' })
            continue
          }
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

          // D-028: a message the receiving server saw FAIL authentication is not attributed to anyone, whoever its From line names
          const auth = senderAuthenticity(parsed.headers?.get('authentication-results'), fromAddress)
          if (auth.verdict === 'failed') {
            result.senderNotRecognized++
            if (isPlausibleSender(fromAddress, maps.oemNameByEmail, maps.profilesByEmail.keys())) await noteUnaddedReply(admin, request.id, fromAddress, `the mail server could not confirm who sent it (${auth.reason})`)
            await admin.from('processed_inbound_emails').insert({ message_id: messageId, request_id: request.id, outcome: 'sender_not_recognized', from_address: fromAddress })
            try {
              const { recordEvents } = await import('@/lib/events/record')
              await recordEvents(
                [{ kind: 'system', target: fromAddress, message: `Reply to ${requestNo} was not added: the message failed sender checks (${auth.reason}).` }],
                { orgId: request.org_id, userId: null },
              )
            } catch { /* logging must never break the sync */ }
            continue
          }

          let sender = resolveKnownSender(fromAddress, maps.profilesByEmail, maps.oemNameByEmail)
          // an OEM's colleague writing from the company's own domain, confirmed by the mail server (never on an unchecked message)
          if (sender.kind === 'unknown' && auth.verdict === 'authentic') sender = resolveOemByDomain(fromAddress, maps.oemNameByDomain) ?? sender

          if (sender.kind === 'unknown') {
            result.senderNotRecognized++
            if (isPlausibleSender(fromAddress, maps.oemNameByEmail, maps.profilesByEmail.keys())) await noteUnaddedReply(admin, request.id, fromAddress, 'the sender is not a known user or OEM contact')
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

          const rawBody = parsed.text || (parsed.html ? htmlToPlainText(String(parsed.html)) : '')
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

          // D-020: claim the e-mail first, then post; a failed post releases the claim so the next run tries again
          const posted = await postReplyOnce(admin, { message_id: messageId, request_id: request.id, from_address: fromAddress }, () => appendEmailReplyComment({ requestId: request.id, body, author }))
          if (posted.outcome === 'posted') result.matched++
          else if (posted.outcome === 'failed' && posted.error) result.errors.push(posted.error)
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
    clearTimeout(watchdog)
    try { await client.logout() } catch { /* already disconnected */ }
  }

  return result
}
