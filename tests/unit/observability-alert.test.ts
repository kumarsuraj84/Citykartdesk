/**
 * DESK-OBS-001 — operator-alert adapter.
 *
 * Requirements from the remediation brief: absent config must degrade
 * safely (never crash the caller), never leak secrets, deduplicate noisy
 * repeated alerts, and be testable via a mock/local transport without any
 * real webhook configured in this environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { alertOperator, __resetAlertDedupForTests } from '@/lib/observability/alert'

describe('alertOperator()', () => {
  beforeEach(() => {
    __resetAlertDedupForTests()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('degrades safely when OPERATOR_ALERT_WEBHOOK_URL is not configured (this environment)', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', '')
    const fetchImpl = vi.fn()
    const result = await alertOperator(
      { key: 'test.unconfigured', severity: 'warning', title: 'x', detail: {} },
      { fetchImpl }
    )
    expect(result).toEqual({ sent: false, reason: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts a JSON payload to the configured webhook on first fire', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', 'https://example.test/webhook')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const result = await alertOperator(
      { key: 'cron.alerts.total_failure', severity: 'critical', title: 'Alerts cron failed', detail: { failed: 3 }, orgId: 'org-1' },
      { fetchImpl }
    )
    expect(result).toEqual({ sent: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://example.test/webhook')
    const body = JSON.parse(init.body)
    expect(body.key).toBe('cron.alerts.total_failure')
    expect(body.detail).toEqual({ failed: 3 })
  })

  it('redacts secret-shaped keys in the detail payload before sending', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', 'https://example.test/webhook')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await alertOperator(
      { key: 'test.redact', severity: 'warning', title: 'x', detail: { apiKey: 'sk-live-123', note: 'safe' } },
      { fetchImpl }
    )
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.detail.apiKey).toBe('[redacted]')
    expect(body.detail.note).toBe('safe')
  })

  it('deduplicates a repeated alert with the same key within the dedup window', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', 'https://example.test/webhook')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    let clock = 1_000_000
    const now = () => clock

    const first = await alertOperator(
      { key: 'test.dedup', severity: 'warning', title: 'x', detail: {} },
      { fetchImpl, now, dedupWindowMs: 60_000 }
    )
    clock += 5_000 // still inside the window
    const second = await alertOperator(
      { key: 'test.dedup', severity: 'warning', title: 'x', detail: {} },
      { fetchImpl, now, dedupWindowMs: 60_000 }
    )

    expect(first).toEqual({ sent: true })
    expect(second).toEqual({ sent: false, reason: 'deduped' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fires again once the dedup window has elapsed', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', 'https://example.test/webhook')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    let clock = 1_000_000
    const now = () => clock

    await alertOperator({ key: 'test.window', severity: 'warning', title: 'x', detail: {} }, { fetchImpl, now, dedupWindowMs: 60_000 })
    clock += 61_000 // just past the window
    const second = await alertOperator({ key: 'test.window', severity: 'warning', title: 'x', detail: {} }, { fetchImpl, now, dedupWindowMs: 60_000 })

    expect(second).toEqual({ sent: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a non-OK webhook response is reported as a failed delivery without throwing', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', 'https://example.test/webhook')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const result = await alertOperator({ key: 'test.non_ok', severity: 'warning', title: 'x', detail: {} }, { fetchImpl })
    expect(result).toEqual({ sent: false, reason: 'delivery_failed' })
  })

  it('a thrown network error is caught and reported, never propagated to the caller', async () => {
    vi.stubEnv('OPERATOR_ALERT_WEBHOOK_URL', 'https://example.test/webhook')
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      alertOperator({ key: 'test.throws', severity: 'critical', title: 'x', detail: {} }, { fetchImpl })
    ).resolves.toEqual({ sent: false, reason: 'delivery_failed' })
  })
})
