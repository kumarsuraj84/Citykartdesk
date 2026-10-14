import { describe, it, expect } from 'vitest'
import { htmlToPlainText, fillHtmlTemplate, STARTER_TEMPLATE_HTML } from '@/lib/email/oem-template'

describe('the text of an HTML e-mail, for the conversation', () => {
  it('turns the starter OEM template into readable lines, table rows as "Label: value"', () => {
    const html = fillHtmlTemplate(STARTER_TEMPLATE_HTML, { ticket_no: 'CKSD-000243', requester_name: 'Store Manager', requester_email: 's@x.org', requester_phone: '98', store_address: 'Main Road\nCivil Lines', subject: 'AC not cooling', description: 'Cooling stopped & the fan is loud' })
    const text = htmlToPlainText(html)
    expect(text).toContain('Dear Team,')
    expect(text).toContain('Ticket No: CKSD-000243')
    expect(text).toContain('Location Address: Main Road\nCivil Lines')
    expect(text).toContain('Issue Description: Cooling stopped & the fan is loud')
    expect(text).toContain('Thanks and Regards,\nCitykart Team')
    expect(text).not.toMatch(/[<>]/)
  })
  it('drops scripts and styles, keeps list items, decodes entities, and does not pile up blank lines', () => {
    const t = htmlToPlainText('<style>p{color:red}</style><p>One &amp; two &lt;3 &#39;x&#39; &nbsp;y</p><p></p><p></p><p></p><ul><li>a</li><li>b</li></ul><script>alert(1)</script>')
    expect(t).toBe("One & two <3 'x'  y\n\n- a\n- b")
  })
  it('is safe on rubbish and unknown entities', () => {
    expect(htmlToPlainText('')).toBe('')
    expect(htmlToPlainText('a &unknown; b &#xZZ; c')).toBe('a &unknown; b &#xZZ; c')
  })
})
