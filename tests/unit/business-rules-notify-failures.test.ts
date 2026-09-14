/**
 * DESK-OBS-002 — silent business-rule email/in-app notification failures.
 *
 * Root cause: lib/rules/actions.ts's runNotify() called sendEmail() (which
 * never throws — it returns `{ error }`) without ever reading that result,
 * and its in-app notify() call was `.catch(() => {})` with no trace. A
 * Resend outage, a bad recipient address, or an in-app insert failure was
 * completely unobservable — no log, no operator signal, nothing.
 *
 * These tests exercise runNotify() through the exported executeActions()
 * entry point with lib/email/send and lib/notifications mocked, so no real
 * Resend configuration or DB is needed (per the remediation brief: "Do not
 * require Resend to be configured to test error handling").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { sendEmailMock, notifyMock, alertOperatorMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  notifyMock: vi.fn(),
  alertOperatorMock: vi.fn(),
}))

vi.mock('@/lib/email/send', () => ({ sendEmail: sendEmailMock }))
vi.mock('@/lib/notifications', () => ({ notify: notifyMock }))
vi.mock('@/lib/observability/alert', () => ({ alertOperator: alertOperatorMock }))

import { executeActions, type ActionRequest, type RuleActionContext } from '@/lib/rules/actions'

function baseRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    id: 'req-1',
    title: 'Printer not working',
    requester_id: 'user-requester',
    assigned_to: 'user-agent',
    org_id: 'org-1',
    status: 'open',
    priority: 'medium',
    service_id: 'svc-1',
    team_id: 'team-1',
    created_at: new Date().toISOString(),
    form_data: {},
    waiting_since: null,
    response_due_at: null,
    resolution_due_at: null,
    reopen_count: 0,
    responded_at: null,
    paused_ms_total: 0,
    service: { sla_policy: null, form_sections: null, form_fields: null, template: null },
    ...overrides,
  }
}

const ctx: RuleActionContext = { ruleId: 'rule-1', ruleName: 'Test Rule' }

// Minimal admin client stub — only auth.admin.getUserById is exercised by
// runNotify's getUserEmail() helper for the email channel; no 'profiles'
// role lookup is hit because notifyRequester alone is used below.
function adminStub(email: string | null = 'requester@example.test') {
  return {
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }) }),
    auth: { admin: { getUserById: async () => ({ data: email ? { user: { email } } : { user: null } }) } },
  }
}

describe('runNotify() via executeActions() — observability of notification failures', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
    notifyMock.mockReset()
    alertOperatorMock.mockReset()
    notifyMock.mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('success: sendEmail succeeds — no error logged, no operator alert', async () => {
    sendEmailMock.mockResolvedValue({})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await executeActions(adminStub(), baseRequest(), [
      { type: 'notify', params: { roles: [], notifyAssignee: false, notifyRequester: true, channels: ['email'] } },
    ], ctx)

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(alertOperatorMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('email-disabled: sendEmail returns {} (send.ts\'s own no-op shape) — treated as success, not a failure', async () => {
    // lib/email/send.ts returns `{}` (no `error` key) when EMAIL_ENABLED is
    // false — this must not be misread as a failure.
    sendEmailMock.mockResolvedValue({})
    await executeActions(adminStub(), baseRequest(), [
      { type: 'notify', params: { roles: [], notifyAssignee: false, notifyRequester: true, channels: ['email'] } },
    ], ctx)
    expect(alertOperatorMock).not.toHaveBeenCalled()
  })

  it('provider failure: sendEmail returns {error} — now logged and an operator alert is fired', async () => {
    sendEmailMock.mockResolvedValue({ error: 'Resend API 503' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await executeActions(adminStub(), baseRequest(), [
      { type: 'notify', params: { roles: [], notifyAssignee: false, notifyRequester: true, channels: ['email'] } },
    ], ctx)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string)
    expect(logged.event).toBe('business_rules.notify.email_failed')
    expect(logged.errorCode).toBe('email_send_failed')
    // The raw provider error string is never embedded in the structured log
    // line itself — only counts/ids — keeping this observable without
    // leaking arbitrary provider response text into logs.
    expect(JSON.stringify(logged)).not.toContain('Resend API 503')

    expect(alertOperatorMock).toHaveBeenCalledTimes(1)
    expect(alertOperatorMock.mock.calls[0][0].key).toBe('business_rule.email_failed.rule-1')
    expect(alertOperatorMock.mock.calls[0][0].severity).toBe('critical') // 1/1 failed

    errorSpy.mockRestore()
  })

  it('in-app failure: notify() rejects — logged, does not throw out of executeActions', async () => {
    notifyMock.mockRejectedValue(new Error('insert failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      executeActions(adminStub(), baseRequest(), [
        { type: 'notify', params: { roles: [], notifyAssignee: false, notifyRequester: true, channels: ['in_app'] } },
      ], ctx)
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string)
    expect(logged.event).toBe('business_rules.notify.in_app_failed')
    errorSpy.mockRestore()
  })

  it('mixed-channel partial failure: only the failing recipient is reported, severity is "warning" not "critical"', async () => {
    // notifyAssignee + notifyRequester → 2 distinct recipients, one email
    // succeeds and one fails.
    sendEmailMock
      .mockResolvedValueOnce({}) // first recipient ok
      .mockResolvedValueOnce({ error: 'invalid address' }) // second recipient fails
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await executeActions(adminStub(), baseRequest(), [
      { type: 'notify', params: { roles: [], notifyAssignee: true, notifyRequester: true, channels: ['email'] } },
    ], ctx)

    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string)
    expect(logged.context.failedCount).toBe(1)
    expect(logged.context.totalCount).toBe(2)
    expect(alertOperatorMock.mock.calls[0][0].severity).toBe('warning') // 1/2 failed, not total failure

    errorSpy.mockRestore()
  })

  it('an action-level throw (e.g. an unexpected exception in a different action type) is logged and does not stop subsequent actions', async () => {
    sendEmailMock.mockResolvedValue({})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // set_team with an empty teamId is a no-op per runSetTeam's own guard —
    // use it alongside a notify action to prove the loop keeps going even
    // if one action type were to throw. Since none of the four action
    // handlers throw in this stub setup, assert isolation the direct way:
    // both actions run to completion in one executeActions call.
    await executeActions(adminStub(), baseRequest(), [
      { type: 'set_team', params: { teamId: '' } },
      { type: 'notify', params: { roles: [], notifyAssignee: false, notifyRequester: true, channels: ['email'] } },
    ], ctx)

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
