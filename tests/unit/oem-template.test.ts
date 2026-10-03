import { describe, it, expect } from 'vitest'
import {
  isHtmlTemplate, plainToHtml, fillHtmlTemplate, inlineEmailStyles, htmlToText, renderHtmlEmail, STARTER_TEMPLATE_HTML,
} from '@/lib/email/oem-template'
import { sanitizeTemplateHtml } from '@/lib/email/sanitize-template'

describe('isHtmlTemplate', () => {
  it.each([
    ['<p>Hello</p>', true], ['  <table><tbody></tbody></table>', true], ['<h2>Title</h2>', true],
    ['Dear Team,\nTicket: {{ticket_no}}', false], ['', false], [null, false], ['Use <b>this</b> text', false],
  ])('%j -> %s', (input, expected) => {
    expect(isHtmlTemplate(input as string | null)).toBe(expected)
  })
})

describe('plainToHtml', () => {
  it('turns lines into escaped paragraphs so an old plain template opens in the editor', () => {
    expect(plainToHtml('Ticket: {{ticket_no}}\n\nA & B <x>')).toBe('<p>Ticket: {{ticket_no}}</p><p></p><p>A &amp; B &lt;x&gt;</p>')
  })
})

describe('fillHtmlTemplate', () => {
  it('fills placeholders and escapes ticket text so it cannot inject HTML', () => {
    const out = fillHtmlTemplate('<td>{{subject}}</td>', { subject: '<script>alert(1)</script>' })
    expect(out).toBe('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>')
  })

  it('keeps line breaks inside a value', () => {
    expect(fillHtmlTemplate('<td>{{description}}</td>', { description: 'line1\nline2' })).toBe('<td>line1<br>line2</td>')
  })

  it('an unknown placeholder becomes empty', () => {
    expect(fillHtmlTemplate('<p>{{nope}}</p>', {})).toBe('<p></p>')
  })
})

describe('inlineEmailStyles', () => {
  it('gives tables borders and padding as inline styles (mail clients ignore stylesheets)', () => {
    const out = inlineEmailStyles('<table><tbody><tr><th>A</th><td>B</td></tr></tbody></table>')
    expect(out).toContain('<table style="border-collapse:collapse')
    expect(out).toMatch(/<td style="[^"]*border:1px solid/)
    expect(out).toMatch(/<th style="[^"]*background-color:#f1f5f9/)
  })

  it('merges with a style the cell already has', () => {
    const out = inlineEmailStyles('<td style="width:120px">x</td>')
    expect(out).toMatch(/<td style="border:1px solid[^"]*;width:120px">/)
  })
})

describe('htmlToText', () => {
  it('produces a readable plain-text version of a table', () => {
    const text = htmlToText('<p>Dear Team,</p><table><tbody><tr><th>Ticket No</th><td>CKSD-1</td></tr><tr><th>Issue</th><td>A &amp; B</td></tr></tbody></table><p>Thanks</p>')
    expect(text).toBe('Dear Team,\nTicket No | CKSD-1\nIssue | A & B\nThanks')
  })
})

describe('table cells saved by the editor (each cell text sits in a <p>)', () => {
  const saved = '<table><tbody><tr><th><p>Ticket No</p></th><td><p>{{ticket_no}}</p></td></tr><tr><th><p>Issue</p></th><td><p>{{subject}}</p><p>second line</p></td></tr></tbody></table>'

  it('flattens cell paragraphs so the email has no stray spacing', () => {
    const { html } = renderHtmlEmail(saved, { ticket_no: 'CKSD-1', subject: 'AC down' })
    expect(html).not.toMatch(/<td[^>]*><p/)
    expect(html).toContain('AC down<br>second line')
  })

  it('keeps the plain-text version to one line per row', () => {
    const { text } = renderHtmlEmail(saved, { ticket_no: 'CKSD-1', subject: 'AC down' })
    expect(text).toBe('Ticket No | CKSD-1\nIssue | AC down\nsecond line')
  })
})

describe('starter template', () => {
  it('renders every ticket detail as a table row', () => {
    const { html, text } = renderHtmlEmail(STARTER_TEMPLATE_HTML, {
      ticket_no: 'CKSD-000009', requester_name: 'Store', requester_email: 's@x.com', requester_phone: '1', store_address: 'Addr', subject: 'AC down', description: 'Not cooling',
    })
    expect(html).toContain('CKSD-000009')
    expect(html).not.toContain('{{')
    expect(text).toContain('Ticket No | CKSD-000009')
    expect(text).toContain('Issue Description | Not cooling')
  })
})

describe('sanitizeTemplateHtml', () => {
  it('keeps normal formatting, tables, colours and safe links', () => {
    const html = '<p><strong>Hi</strong> <span style="color:#dc2626">red</span></p><table><tbody><tr><th>A</th><td style="width:50%">B</td></tr></tbody></table><a href="https://x.com">x</a>'
    const out = sanitizeTemplateHtml(html)
    expect(out).toContain('<table>')
    expect(out).toContain('color:#dc2626')
    expect(out).toContain('width:50%')
    expect(out).toContain('href="https://x.com"')
  })

  it('removes scripts, event handlers, iframes, images and javascript: links', () => {
    const out = sanitizeTemplateHtml(
      '<p onclick="x()">a</p><script>alert(1)</script><iframe src="https://evil"></iframe><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>'
    )
    expect(out).not.toMatch(/script|onclick|iframe|<img|onerror|javascript:/i)
    expect(out).toContain('<p>a</p>')
  })

  it('drops styles other than colour, alignment and width', () => {
    const out = sanitizeTemplateHtml('<p style="position:fixed;top:0;color:#111111">x</p>')
    expect(out).toContain('color:#111111')
    expect(out).not.toContain('position')
  })

  it('leaves {{placeholders}} untouched', () => {
    expect(sanitizeTemplateHtml('<td>{{ticket_no}}</td>')).toContain('{{ticket_no}}')
  })
})
