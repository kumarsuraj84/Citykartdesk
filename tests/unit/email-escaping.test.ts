/**
 * D-05 — outbound HTML email interpolated user-controlled content (request
 * titles, comments, task/milestone/project names, business-rule bodies,
 * rejection reasons) with no escaping anywhere in the codebase. A request
 * titled `<script>alert(1)</script>` would render as live, executing HTML
 * in the recipient's mail client.
 *
 * Pure-function unit tests — no network/DB needed, matching the payloads
 * specified in the remediation brief.
 */
import { describe, it, expect } from 'vitest'
import { escapeHtml, escapeEmailFields } from '@/lib/email/escape'
import {
  requestCreatedEmail,
  commentAddedEmail,
  approvalDecisionEmail,
  taskAssignedEmail,
} from '@/lib/email/templates'

const PAYLOADS = {
  bold: '<b>UAT TEST</b>',
  ampersand: 'A & B',
  quoted: '"quoted"',
  script: '<script>alert(1)</script>',
}

describe('D-05: escapeHtml()', () => {
  it('escapes < and > so tags cannot open/close', () => {
    expect(escapeHtml(PAYLOADS.script)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml(PAYLOADS.script)).not.toContain('<script>')
  })

  it('escapes &', () => {
    expect(escapeHtml(PAYLOADS.ampersand)).toBe('A &amp; B')
  })

  it('escapes double and single quotes (attribute-injection safe)', () => {
    expect(escapeHtml(PAYLOADS.quoted)).toBe('&quot;quoted&quot;')
    expect(escapeHtml(`it's`)).toBe('it&#39;s')
  })

  it('inert markup like <b> is also escaped — rendered as visible text, not as HTML', () => {
    expect(escapeHtml(PAYLOADS.bold)).toBe('&lt;b&gt;UAT TEST&lt;/b&gt;')
  })
})

describe('D-05: escapeEmailFields()', () => {
  it('escapes every string field except the named trusted keys', () => {
    const out = escapeEmailFields(
      { title: PAYLOADS.script, url: 'https://example.test/x?a=1&b=2', count: 3 },
      ['url']
    )
    expect(out.title).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out.url).toBe('https://example.test/x?a=1&b=2') // untouched
    expect(out.count).toBe(3) // non-string passes through
  })
})

describe('D-05: email templates render user content as inert text, not executable HTML', () => {
  it('requestCreatedEmail: malicious title/service name are escaped in html, left readable in text', () => {
    const { html, text } = requestCreatedEmail({
      requesterName: PAYLOADS.script,
      requestTitle: PAYLOADS.script,
      requestUrl: 'https://desk.example.test/requests/1',
      serviceName: PAYLOADS.ampersand,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('A &amp; B')
    // The URL itself must NOT be escaped (it's our own constructed link, not user input)
    expect(html).toContain('href="https://desk.example.test/requests/1"')
    // Plain-text version is unescaped — a mail client's text view isn't parsed as HTML
    expect(text).toContain(PAYLOADS.script)
  })

  it('commentAddedEmail: a <script> comment body cannot execute in the html body', () => {
    const { html } = commentAddedEmail({
      recipientName: 'Requester',
      requestTitle: 'Printer not working',
      requestUrl: 'https://desk.example.test/requests/2',
      commenterName: PAYLOADS.bold,
      commentBody: `Update: ${PAYLOADS.script} still broken`,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<b>UAT TEST</b>')
  })

  it('approvalDecisionEmail: rejection reason is escaped', () => {
    const { html } = approvalDecisionEmail({
      recipientName: 'Requester',
      requestTitle: 'Laptop request',
      requestUrl: 'https://desk.example.test/requests/3',
      decision: 'rejected',
      reason: PAYLOADS.script,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('taskAssignedEmail: malicious task title is escaped', () => {
    const { html } = taskAssignedEmail({
      recipientName: 'Agent',
      taskTitle: PAYLOADS.script,
      taskUrl: 'https://desk.example.test/tasks/4',
      assignerName: 'Manager',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
