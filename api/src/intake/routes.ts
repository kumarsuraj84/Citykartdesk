import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'
import { log } from '../lib/log.js'
import { readImapCredentials } from './credentials.js'
import { testConnection } from './imap.js'
import { pollAllChannels } from './poller.js'
import { classifyBacklog } from './classify/orchestrator.js'
import { LocalModelClassifier, localModelConfigured } from './classify/local-model-classifier.js'
import type { IntakeEnvelope } from './classify/types.js'
import { sendEmail } from './smtp.js'
import { syncGmailChannel } from './gmail-sync.js'
import { syncGraphMessage } from './graph-sync.js'

export const intakeRouter = Router()

// Worker-internal auth: callers must present x-intake-worker-secret. Used by the
// Vercel app (testChannel) and by the cron tick (manual poll trigger).
function requireWorkerSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!secret) {
    res.status(503).json({ error: 'worker secret not configured' })
    return
  }
  const provided = req.headers['x-intake-worker-secret'] ?? req.headers['x-cron-secret']
  if (provided !== secret) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}

// Build marker + live pipeline readout. PUBLIC (no secret) — exposes only
// non-sensitive build info so the running Railway build can be verified with a
// plain GET. If this 404s, the worker is on an OLD build that predates this
// endpoint; if defaultStageOrder starts with 'local_model', the model-first
// build is live. This is the ground truth for "is the new code actually deployed".
const BUILD = 'native-api-push-2026-06-24'

intakeRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    build: BUILD,
    localModelConfigured: localModelConfigured(),
    defaultStageOrder: localModelConfigured() ? ['local_model', 'rule'] : ['rule'],
    nativeApiRoutes: ['gmail-sync', 'graph-sync'],
  })
})

// Manually trigger a poll of all active channels (also called on a schedule).
intakeRouter.post('/poll', requireWorkerSecret, async (_req, res) => {
  try {
    const result = await pollAllChannels()
    res.json({ ok: true, ...result })
  } catch (err) {
    log.error('poll failed', err)
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'poll failed' })
  }
})

// Backfill: classify all messages that don't yet have a review.
// Returns immediately; runs the backfill in the background so callers never time out.
intakeRouter.post('/reclassify', requireWorkerSecret, (req, res) => {
  const limit = Number(req.body?.limit ?? 1000)
  const force = req.body?.force === true
  res.json({ ok: true, message: 'reclassification started', limit, force })
  // Run after response is flushed so Vercel/fetch doesn't wait.
  setImmediate(async () => {
    try {
      const result = await classifyBacklog(limit, force)
      log.info('reclassify backlog complete', result)
    } catch (err) {
      log.error('reclassify failed', err)
    }
  })
})

// Smoke-test Stage 2: run one sample email through the local model and return
// the raw result WITHOUT persisting anything. Confirms the API key / endpoint /
// model are wired correctly before committing to a full re-classify.
intakeRouter.post('/test-classify', requireWorkerSecret, async (req, res) => {
  if (!localModelConfigured()) {
    res.json({ ok: false, error: 'INTAKE_LLM_API_KEY is not set on the worker.' })
    return
  }

  const sample: IntakeEnvelope = {
    subject: req.body?.subject ?? 'Urgent: laptop not turning on, need a replacement',
    text: req.body?.text ?? 'Hi team, my work laptop died this morning and will not power on. ' +
      'I have a client demo at 3pm — can someone please arrange a replacement or a loaner ASAP? Thanks.',
    sender: req.body?.sender ?? 'employee@example.com',
    channelType: 'email',
  }

  const started = Date.now()
  try {
    const classifier = new LocalModelClassifier()
    const result = await classifier.classify(sample)
    res.json({
      ok: true,
      provider: classifier.provider,
      model: classifier.modelVersion,
      latencyMs: Date.now() - started,
      sample: { subject: sample.subject, text: sample.text },
      result,
    })
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : 'classification failed' })
  }
})

// Send a reply, reply-all, or forward from a channel's mailbox.
intakeRouter.post('/send', requireWorkerSecret, async (req, res) => {
  const { messageId, senderId, action, toAddresses, ccAddresses, subject, bodyText, bodyHtml } = req.body ?? {}

  if (!messageId || !action || !toAddresses?.length || !subject) {
    res.status(400).json({ ok: false, error: 'messageId, action, toAddresses, subject required' })
    return
  }

  // Load the originating message + its channel.
  const { data: msg } = await supabase
    .from('intake_messages')
    .select('id, org_id, channel_id, from_address, external_message_id, intake_channels!inner(id, credentials_ref, config)')
    .eq('id', messageId)
    .maybeSingle()

  if (!msg) { res.json({ ok: false, error: 'message not found' }); return }

  const channel = ((msg as unknown as { intake_channels: { id: string; credentials_ref: string | null; config: unknown }[] }).intake_channels ?? [])[0]
  if (!channel?.credentials_ref) {
    res.json({ ok: false, error: 'channel has no credentials' })
    return
  }

  const creds = await readImapCredentials(channel.credentials_ref)
  if (!creds) { res.json({ ok: false, error: 'credentials unreadable' }); return }

  // Normalise the original Message-ID to RFC5322 angle-bracket form so mail
  // clients actually thread the reply, and set References (not just In-Reply-To).
  const rawMessageId = (msg as { external_message_id?: string }).external_message_id ?? ''
  const threadMessageId = rawMessageId && !rawMessageId.startsWith('<') ? `<${rawMessageId}>` : (rawMessageId || undefined)

  const result = await sendEmail(creds, {
    from:       creds.user,
    to:         toAddresses,
    cc:         ccAddresses ?? [],
    subject,
    text:       bodyText ?? '',
    html:       typeof bodyHtml === 'string' && bodyHtml.trim() ? bodyHtml : undefined,
    inReplyTo:  threadMessageId,
    references: threadMessageId ? [threadMessageId] : undefined,
  })

  // Log the outbound record regardless of success so we have an audit trail.
  await supabase.from('intake_outbound').insert({
    org_id:         (msg as { org_id: string }).org_id,
    channel_id:     channel.id,
    in_reply_to_id: messageId,
    action,
    to_addresses:   toAddresses,
    cc_addresses:   ccAddresses ?? [],
    subject,
    body_text:      bodyText ?? '',
    sent_by:        senderId ?? null,
    status:         result.ok ? 'sent' : 'failed',
    error:          result.error ?? null,
  })

  log.info(`intake send ${action} => ${result.ok ? 'sent' : 'failed'}`, { messageId, to: toAddresses })
  res.json(result)
})

// Gmail native API sync — called by the Pub/Sub webhook when new mail arrives.
// Takes { channelId, historyId } and fetches all messages added since that point.
intakeRouter.post('/gmail-sync', requireWorkerSecret, async (req, res) => {
  const { channelId, historyId } = req.body ?? {}
  log.info(`gmail-sync request received`, { channelId, historyId })
  if (!channelId || !historyId) {
    log.warn(`gmail-sync: missing channelId or historyId`, { channelId, historyId })
    res.status(400).json({ ok: false, error: 'channelId and historyId required' })
    return
  }
  try {
    log.info(`gmail-sync: starting sync for channel ${channelId}`)
    const result = await syncGmailChannel(channelId, String(historyId))
    log.info(`gmail-sync: completed`, result)
    res.json({ ok: true, ...result })
  } catch (err) {
    log.error('gmail-sync failed', err)
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'gmail-sync failed' })
  }
})

// Microsoft Graph native API sync — called by the Graph change-notification webhook.
// Takes { channelId, graphMessageId } and fetches the single new message.
intakeRouter.post('/graph-sync', requireWorkerSecret, async (req, res) => {
  const { channelId, graphMessageId } = req.body ?? {}
  if (!channelId || !graphMessageId) {
    res.status(400).json({ ok: false, error: 'channelId and graphMessageId required' })
    return
  }
  try {
    const result = await syncGraphMessage(channelId, String(graphMessageId))
    res.json({ ok: true, ...result })
  } catch (err) {
    log.error('graph-sync failed', err)
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'graph-sync failed' })
  }
})

// Test a channel's stored credentials by attempting an IMAP connection.
intakeRouter.post('/test-channel', requireWorkerSecret, async (req, res) => {
  const { channelId } = req.body ?? {}
  if (!channelId) {
    res.status(400).json({ ok: false, error: 'channelId required' })
    return
  }

  const { data: channel } = await supabase
    .from('intake_channels')
    .select('id, credentials_ref, config')
    .eq('id', channelId)
    .maybeSingle()

  if (!channel?.credentials_ref) {
    res.json({ ok: false, error: 'no credentials stored for this channel' })
    return
  }

  const creds = await readImapCredentials(channel.credentials_ref)
  if (!creds) {
    res.json({ ok: false, error: 'credentials unreadable from Vault' })
    return
  }

  const folder = (channel.config as { folder?: string } | null)?.folder ?? 'INBOX'
  const result = await testConnection(creds, folder)
  res.json(result)
})
