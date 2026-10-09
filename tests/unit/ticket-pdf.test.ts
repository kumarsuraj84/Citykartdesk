import { describe, it, expect } from 'vitest'
import { buildTicketPdfModel, ticketPdfFileName, type TicketPdfInput } from '@/lib/requests/ticket-pdf-model'
import { renderTicketPdf, splitScripts } from '@/lib/pdf/ticket-pdf'

const iso = (d: number) => new Date(Date.UTC(2026, 9, d, 6, 30)).toISOString()

const field = (id: string, label: string, type: string, extra: object = {}) => ({ id, label, type, order: 0, ...extra })

function input(over: Partial<TicketPdfInput> = {}): TicketPdfInput {
  return {
    request: {
      id: 'r1', request_no: 'CKSD-001234', title: 'AC not cooling', description: null, status: 'in_progress', priority: 'high',
      created_at: iso(1), response_due_at: iso(2), responded_at: iso(1), resolution_due_at: iso(4), resolved_at: null, closed_at: null, reopen_count: 1,
      source_metadata: { created_via: 'whatsapp' }, team_id: 't1',
      requester: { full_name: 'Store A' }, assignee: { full_name: 'Krishan' }, team: { name: 'ADMIN GROUP' }, service: { name: 'Admin repair' },
      category: { name: 'AC ISSUE' }, sub_category: { name: 'COOLING' },
      form_data: { subj: 'Shop AC', desc: 'Not cooling since morning', phone: '9999999999', secret: 'technician only value' },
      form_schema_snapshot: [],
      form_sections_snapshot: [{ id: 's1', order: 0, title: 'Request', fields: [
        field('subj', 'Subject', 'text', { requester_can_view: true }),
        field('desc', 'Description', 'textarea', { requester_can_view: true }),
        field('phone', 'Phone Number', 'text', { requester_can_view: true }),
        field('secret', 'Internal reference', 'text', { requester_can_view: false }),
      ] }],
    } as never,
    comments: [
      { id: 'c2', body: 'Technician reply', is_internal: false, created_at: iso(2), author: { id: 'u2', full_name: 'Krishan' }, source: 'portal' },
      { id: 'c1', body: 'First message', is_internal: false, created_at: iso(1), author: { id: 'u1', full_name: 'Store A' }, source: 'portal' },
      { id: 'c3', body: 'PRIVATE NOTE for technicians', is_internal: true, created_at: iso(2), author: { id: 'u2', full_name: 'Krishan' }, source: 'portal' },
      { id: 'c4', body: 'Reply by email', is_internal: false, created_at: iso(3), author: null, external_name: 'OEM Contact', source: 'email' },
    ] as never,
    activity: [
      { action: 'comment_added', created_at: iso(2), metadata: {}, actor: { id: 'u2', full_name: 'Krishan' } },
      { action: 'status_changed', created_at: iso(2), metadata: { from: 'open', to: 'in_progress' }, actor: { id: 'u2', full_name: 'Krishan' } },
      { action: 'created', created_at: iso(1), metadata: {}, actor: null },
    ] as never,
    attachments: [
      { file_name: 'photo.jpg', file_size: 2_500_000, uploaded_at: iso(1), uploader: { id: 'u1', full_name: 'Store A' }, is_internal: false, deleted_at: null },
      { file_name: 'internal-quote.pdf', file_size: 1000, uploaded_at: iso(2), uploader: { id: 'u2', full_name: 'Krishan' }, is_internal: true, deleted_at: null },
    ] as never,
    approvals: [],
    csat: null,
    viewer: { name: 'Krishan', isAgent: true },
    now: new Date(Date.UTC(2026, 9, 9, 6, 30)),
    ...over,
  }
}

describe('ticket PDF content', () => {
  it('never includes internal notes or internal attachments, for a technician too', () => {
    const m = buildTicketPdfModel(input())
    expect(JSON.stringify(m)).not.toContain('PRIVATE NOTE')
    expect(JSON.stringify(m)).not.toContain('internal-quote.pdf')
    expect(m.attachments.map((a) => a.name)).toEqual(['photo.jpg'])
    expect(m.attachments[0].size).toBe('2.4 MB')
  })

  it('lists the conversation oldest first, with who and when, including emailed replies from outsiders', () => {
    const m = buildTicketPdfModel(input())
    expect(m.conversation.map((c) => c.body)).toEqual(['First message', 'Technician reply', 'Reply by email'])
    expect(m.conversation[2]).toMatchObject({ author: 'OEM Contact', via: 'via email' })
    expect(m.conversation[0].at).toMatch(/Oct 2026/)
  })

  it('puts the requester\'s description on its own and the rest of the form under submitted information', () => {
    const m = buildTicketPdfModel(input())
    expect(m.description).toBe('Not cooling since morning')
    expect(m.submitted.map((s) => s.label)).toEqual(['Subject', 'Phone Number', 'Internal reference'])
  })

  it('hides technician-only fields from a requester but shows them to a technician', () => {
    const asRequester = buildTicketPdfModel(input({ viewer: { name: 'Store A', isAgent: false } }))
    expect(asRequester.submitted.map((s) => s.label)).toEqual(['Subject', 'Phone Number'])
    expect(JSON.stringify(asRequester)).not.toContain('technician only value')
  })

  it('history leaves out comment rows (they are in the conversation) and reads in time order', () => {
    const m = buildTicketPdfModel(input())
    expect(m.history.map((h) => h.text)).toEqual(['Request submitted', 'Status: Open to In Progress'])
    expect(m.history[1].by).toBe('Krishan')
  })

  it('shows the details a technician needs: SLA dates, group, service, times reopened, source', () => {
    const d = Object.fromEntries(buildTicketPdfModel(input()).details.map((x) => [x.label, x.value]))
    expect(d).toMatchObject({ Status: 'In Progress', Priority: 'High', 'Raised via': 'Whatsapp', Technician: 'Krishan', 'Technician group': 'ADMIN GROUP', Service: 'Admin repair', Category: 'AC ISSUE > COOLING', 'Times reopened': '1' })
    expect(d['Resolution due']).toMatch(/Oct 2026/)
    expect(d.Resolved).toBe('-')
  })

  it('names the file after the ticket number', () => {
    expect(ticketPdfFileName('CKSD-001234')).toBe('CKSD-001234.pdf')
    expect(ticketPdfFileName('../x y')).toBe('xy.pdf')
  })
})

describe('ticket PDF file', () => {
  it('sends only Hindi letters to the Hindi font; spaces, commas, brackets and digits stay with the English font', () => {
    expect(splitScripts('AC नहीं, चल 12')).toEqual([{ text: 'AC ', dev: false }, { text: 'नहीं', dev: true }, { text: ', ', dev: false }, { text: 'चल', dev: true }, { text: ' 12', dev: false }])
    expect(splitScripts('plain')).toEqual([{ text: 'plain', dev: false }])
  })

  it('renders a real PDF with the ticket text, Hindi included, over several pages when the conversation is long', async () => {
    const long = 'A long message about the store problem. '.repeat(40)
    const m = buildTicketPdfModel(input({
      comments: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, body: i === 0 ? 'दुकान का एसी काम नहीं कर रहा है, please check' : long, is_internal: false, created_at: iso(1 + (i % 20)), author: { id: 'u', full_name: 'Store A' }, source: 'portal' })) as never,
    }))
    const pdf = await renderTicketPdf(m, { compress: false })
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(pdf.length).toBeGreaterThan(20_000)
    const pages = (text.match(/\/Type \/Page\b/g) ?? []).length
    expect(pages).toBeGreaterThan(2)
    expect(text).toContain('+NotoSans-') // the English font is embedded
    expect(text).toContain('+NotoSansDevanagari') // and the Hindi one, because a message used it
  })
})
