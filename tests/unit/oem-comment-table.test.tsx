// The conversation note "Ticket sent to the AC / Genset OEM" keeps the mail's table as a table: it is written as "Label | value" lines (further lines of a value indented)
// and read back into a table by the ticket page. A note of the old shape (written before this) is shown as plain text, as before.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { acVars, gensetVars, masterSentComment, renderMasterMail, resolveTemplate } from '@/lib/masters/mail'
import { parseOemComment } from '@/lib/masters/comment-view'
import { htmlToCommentText } from '@/lib/email/oem-template'
import { OemSentComment } from '@/components/requests/OemSentComment'

const TO = ['service@oem.test', 'two@oem.test']
const CC = ['desk@citykartstores.com']
const unit = { id: 'u', ckdesk_no: '3', serial: 'S-1', brand: 'DAIKIN', floor: 'FF', ac_type: 'Ductable', tonnage: '5 TR', amc_vendor: 'DAIKIN', amc_brand: null } as never

function note(kind: 'ac' | 'genset', description: string) {
  const tpl = resolveTemplate(null, kind)
  const vars = {
    ticket_no: 'CKSD-000999', subject: 'AC Not Working', description, requester_name: 'SDH', requester_email: 'sdh@citykartstores.com', requester_phone: '8090656996',
    store_address: 'Khasra 5, Old Bus Stand Road', store_code: 'SDH', category: 'ADMIN AC ISSUE',
    ...(kind === 'ac' ? acVars(unit) : gensetVars([{ brand: 'MAHINDRA', kva: '125', serial: 'NDJ1', cpcb_group: 'CPCB-II' } as never])),
  }
  const mail = renderMasterMail(tpl, vars)
  return masterSentComment({ label: kind === 'ac' ? 'AC' : 'Genset', to: TO, cc: CC, subject: mail.subject, html: mail.html })
}

describe('the OEM note in the conversation', () => {
  const desc = 'Dear Sir,\n   One AC is not working.\n\nThanks | SM\nSDH Team'
  const body = note('ac', desc)
  const view = parseOemComment(body)

  it('is written as plain text with "Label | value" rows and a marker line', () => {
    expect(body.startsWith('Ticket sent to the AC OEM for servicing.')).toBe(true)
    expect(body).toContain('Subject: New AC Issue Ticket - CKSD-000999 - SDH')
    expect(body).toContain('CC: desk@citykartstores.com')
    expect(body).toContain('Message sent:')
    expect(body).toMatch(/^Ticket No \| CKSD-000999$/m)
    expect(body).toMatch(/^Store Code \| SDH$/m)
  })

  it('reads back into a table: every label with its own value', () => {
    expect(view).not.toBeNull()
    const table = view!.blocks.find((b) => b.kind === 'table')
    expect(table?.kind).toBe('table')
    const rows = (table as { rows: { label: string; value: string }[] }).rows
    const get = (l: string) => rows.find((r) => r.label === l)?.value
    expect(get('Ticket No')).toBe('CKSD-000999')
    expect(get('Contact Person')).toBe('SDH')
    expect(get('Store Code')).toBe('SDH')
    expect(get('Issue')).toBe('AC Not Working')
  })

  it('keeps a long description in its own row: its extra lines, its blank line and a "|" typed by the requester stay inside it', () => {
    const table = view!.blocks.find((b) => b.kind === 'table') as { rows: { label: string; value: string }[] }
    const issue = table.rows.find((r) => r.label === 'Issue Description')!.value
    expect(issue).toContain('Dear Sir,')
    expect(issue).toContain('One AC is not working.')
    expect(issue).toContain('Thanks | SM')
    expect(issue).toContain('SDH Team')
    expect(issue.split('\n').length).toBeGreaterThanOrEqual(5)
  })

  it('shows the greeting and the closing outside the table, and who the mail went to', () => {
    const texts = view!.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text)
    expect(texts.some((t) => /^Dear Team,/.test(t))).toBe(true)
    expect(texts.some((t) => /Thanks and Regards,\nCitykart Team/.test(t))).toBe(true)
    expect(view!.meta.map((m) => m.label)).toEqual(['Subject', 'To', 'CC'])
    expect(view!.meta.find((m) => m.label === 'To')?.value).toBe('service@oem.test, two@oem.test')
  })

  it('a genset note is a table too, with the genset details row', () => {
    const g = parseOemComment(note('genset', 'Genset trips'))!
    const rows = (g.blocks.find((b) => b.kind === 'table') as { rows: { label: string; value: string }[] }).rows
    expect(rows.find((r) => r.label === 'Genset Details')?.value).toContain('MAHINDRA 125 KVA')
  })

  it('is drawn as a real HTML table, and ticket text can never become markup', () => {
    const evil = parseOemComment(note('ac', '<script>alert(1)</script> <b>x</b>'))!
    const html = renderToStaticMarkup(<OemSentComment view={evil} />)
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(renderToStaticMarkup(<OemSentComment view={view!} />)).toContain('Ticket sent to the AC OEM for servicing.')
  })

  it('an older note (before this change) and any other comment stay plain text', () => {
    const old = 'Ticket sent to the AC OEM for servicing.\n\nSubject: New AC Issue Ticket - CKSD-000520 - SDH\nTo: a@oem.test\n\nDear Team,\nTicket No | CKSD-000520\nContact Person | SDH'
    expect(parseOemComment(old)).toBeNull()
    expect(parseOemComment('Hello NAH, a technician has started working on your request.')).toBeNull()
    expect(parseOemComment('')).toBeNull()
  })

  it('an empty value and a value with an HTML special character are kept', () => {
    const text = htmlToCommentText('<table><tbody><tr><th>AC Serial No</th><td></td></tr><tr><th>Issue</th><td>a &lt; b &amp; c</td></tr></tbody></table>')
    expect(text).toBe('AC Serial No |\nIssue | a < b & c')
  })
})
