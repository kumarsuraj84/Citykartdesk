import express from 'express'
import { log } from './lib/log.js'
import { intakeRouter } from './intake/routes.js'
import { pollAllChannels } from './intake/poller.js'
import { escalateCatchUp, classifyBacklog } from './intake/classify/orchestrator.js'

const app  = express()
const port = parseInt(process.env.PORT ?? '3001', 10)

app.use(express.json({ limit: '2mb' }))

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cognix-api', ts: new Date().toISOString() })
})

// ── Intake Intelligence routes (Phase B: ingestion) ────────────────────────
app.use('/intake', intakeRouter)

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  log.info(`cognix-api listening on port ${port}`)
})

// ── Scheduler: poll mailboxes on an interval (off-Vercel) ──────────────────
// INTAKE_POLL_INTERVAL_MS defaults to 5 minutes. Set to 0 to disable the
// internal scheduler (e.g. when driving polls externally via the cron tick).
const pollIntervalMs = parseInt(process.env.INTAKE_POLL_INTERVAL_MS ?? '300000', 10)
if (pollIntervalMs > 0) {
  log.info(`mailbox poller scheduled every ${Math.round(pollIntervalMs / 1000)}s`)
  let running = false
  setInterval(async () => {
    if (running) return // prevent overlapping runs
    running = true
    try {
      const result = await pollAllChannels()
      if (result.stored > 0) log.info('scheduled poll complete', result)
      // Heal stored-but-unclassified mail by creating its review. Earlier
      // interrupted polls (or messages that returned as duplicates on a resync,
      // so the live path skipped them) can leave messages with no review and
      // therefore nothing in the inbox/review queue. unclassifiedOnly targets
      // status new/normalized so the batch always drains genuinely-pending mail
      // instead of re-scanning the oldest (already-classified) rows.
      await classifyBacklog(5000, false, true).catch((e) => log.error('backlog classify failed', e))
      // Catch up any historical actionable mail that hasn't reached Stage 2 yet.
      // Resumable + restart-safe: a small batch per tick until the backlog clears.
      if (process.env.INTAKE_AUTO_ESCALATE !== 'false') {
        await escalateCatchUp().catch((e) => log.error('escalation catch-up failed', e))
      }
    } catch (err) {
      log.error('scheduled poll failed', err)
    } finally {
      running = false
    }
  }, pollIntervalMs)
}
