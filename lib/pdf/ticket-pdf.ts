// Draws a ticket's PDF (see lib/requests/ticket-pdf-model.ts for what goes in it).
// English text uses Noto Sans and Hindi (Devanagari) text uses Noto Sans Devanagari, both shipped in assets/fonts, so
// Hindi in a comment or form answer prints as real letters instead of empty boxes.

import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { TicketPdfModel } from '@/lib/requests/ticket-pdf-model'

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const FONT_FILES = {
  regular: 'noto-sans-latin-400-normal.woff',
  bold: 'noto-sans-latin-700-normal.woff',
  devRegular: 'noto-sans-devanagari-devanagari-400-normal.woff',
  devBold: 'noto-sans-devanagari-devanagari-700-normal.woff',
} as const

const INK = '#1f2937'
const MUTED = '#6b7280'
const BRAND = '#1b4f95'
const RULE = '#d9dde5'
const PAGE = { left: 40, right: 40, top: 40, bottom: 56 }

// Only these go to the Hindi font: Devanagari letters and marks, the joiners inside words, the rupee sign and the dotted circle.
// Everything else (spaces, digits, commas, brackets, English) uses the English font, because the Hindi font does not contain them.
// (Unicode ranges as numbers: Devanagari 0900-097F, Devanagari Extended A8E0-A8FF, Vedic Extensions 1CD0-1CFF,
// zero-width joiners 200C-200D, rupee sign 20B9, dotted circle 25CC.)
const DEVANAGARI_RANGES: [number, number][] = [[0x0900, 0x097f], [0xa8e0, 0xa8ff], [0x1cd0, 0x1cff], [0x200c, 0x200d], [0x20b9, 0x20b9], [0x25cc, 0x25cc]]
const isDevanagari = (ch: string) => { const c = ch.codePointAt(0) ?? 0; return DEVANAGARI_RANGES.some(([from, to]) => c >= from && c <= to) }

/** Splits text into runs that each use one font: Devanagari in one run, everything else in another. */
export function splitScripts(text: string): { text: string; dev: boolean }[] {
  const runs: { text: string; dev: boolean }[] = []
  for (const ch of text) {
    const dev = isDevanagari(ch)
    const last = runs[runs.length - 1]
    if (last && last.dev === dev) last.text += ch
    else runs.push({ text: ch, dev })
  }
  return runs
}


export async function renderTicketPdf(model: TicketPdfModel, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
    bufferPages: true,
    compress: opts.compress ?? true,
    font: path.join(FONT_DIR, FONT_FILES.regular),
    info: { Title: `${model.requestNo} - ${model.title}`, Author: 'Citykart Desk', Subject: 'Ticket details and conversation' },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject) })

  doc.registerFont('regular', path.join(FONT_DIR, FONT_FILES.regular))
  doc.registerFont('bold', path.join(FONT_DIR, FONT_FILES.bold))
  doc.registerFont('devRegular', path.join(FONT_DIR, FONT_FILES.devRegular))
  doc.registerFont('devBold', path.join(FONT_DIR, FONT_FILES.devBold))

  const width = doc.page.width - PAGE.left - PAGE.right
  const fontFor = (bold: boolean, dev: boolean) => (dev ? (bold ? 'devBold' : 'devRegular') : bold ? 'bold' : 'regular')

  /** Writes text at the current position, switching fonts where the script changes. */
  const write = (text: string, o: { size?: number; bold?: boolean; color?: string; width?: number; x?: number; lineGap?: number } = {}) => {
    const runs = splitScripts(text || '-')
    doc.fillColor(o.color ?? INK).fontSize(o.size ?? 9.5)
    const x = o.x ?? doc.x
    runs.forEach((run, i) => {
      doc.font(fontFor(!!o.bold, run.dev))
      const last = i === runs.length - 1
      if (i === 0) doc.text(run.text, x, doc.y, { width: o.width ?? width, continued: !last, lineGap: o.lineGap ?? 1.5 })
      else doc.text(run.text, { continued: !last, lineGap: o.lineGap ?? 1.5 })
    })
  }
  const heightOf = (text: string, size: number, w: number, bold = false) => {
    // measured in the main font; Hindi lines can be a little taller, which the page-break margin absorbs
    doc.font(bold ? 'bold' : 'regular').fontSize(size)
    return doc.heightOfString(text || '-', { width: w, lineGap: 1.5 })
  }
  const ensure = (h: number) => { if (doc.y + h > doc.page.height - PAGE.bottom) { doc.addPage() } }
  const gap = (h = 6) => { doc.y += h }
  const left = () => { doc.x = PAGE.left }

  const section = (title: string, count?: number) => {
    ensure(40)
    left(); gap(10)
    write(count !== undefined ? `${title}  (${count})` : title, { size: 11.5, bold: true, color: BRAND })
    doc.moveTo(PAGE.left, doc.y + 1).lineTo(PAGE.left + width, doc.y + 1).strokeColor(RULE).lineWidth(0.8).stroke()
    gap(6); left()
  }

  /** Two-column "label  value" rows. */
  const keyValues = (rows: { label: string; value: string }[], labelW = 150) => {
    for (const r of rows) {
      const valueW = width - labelW - 8
      const h = Math.max(heightOf(r.label, 8.5, labelW, true), heightOf(r.value, 9.5, valueW))
      ensure(h + 4)
      const y = doc.y
      left()
      write(r.label, { size: 8.5, bold: true, color: MUTED, width: labelW, x: PAGE.left })
      doc.y = y
      write(r.value, { size: 9.5, width: valueW, x: PAGE.left + labelW + 8 })
      doc.y = y + h + 3
    }
    left()
  }

  // ── Title block ──
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND)
  doc.y = PAGE.top + 4; left()
  write('Citykart Desk', { size: 8.5, bold: true, color: MUTED })
  write(`${model.requestNo}`, { size: 18, bold: true, color: BRAND })
  write(model.title, { size: 12.5, bold: true })
  gap(2)
  write(`${model.status}  |  ${model.priority} priority`, { size: 9.5, color: MUTED })

  section('Ticket details')
  keyValues(model.details)

  if (model.description) {
    section('Description')
    write(model.description, { size: 9.5 })
    left()
  }
  if (model.submitted.length > 0) {
    section('Submitted information')
    keyValues(model.submitted)
  }

  section('Conversation', model.conversation.length)
  if (model.conversation.length === 0) write('No messages on this ticket yet.', { color: MUTED })
  for (const c of model.conversation) {
    const headerLine = `${c.author}${c.via ? `  (${c.via})` : ''}  -  ${c.at}`
    ensure(heightOf(headerLine, 9, width, true) + Math.min(heightOf(c.body, 9.5, width - 12), 60) + 12)
    left()
    const top = doc.y
    write(headerLine, { size: 9, bold: true, color: BRAND, x: PAGE.left + 8, width: width - 12 })
    write(c.body || '-', { size: 9.5, x: PAGE.left + 8, width: width - 12 })
    const bottom = doc.y
    // a thin bar down the left edge ties a message together even across a page break
    doc.moveTo(PAGE.left + 2, top).lineTo(PAGE.left + 2, bottom).strokeColor(RULE).lineWidth(2).stroke()
    gap(7); left()
  }

  if (model.approvals.length > 0) {
    section('Approvals')
    for (const a of model.approvals) {
      ensure(30); left()
      write(`${a.title}  -  ${a.status}${a.waitingOn ? `  (waiting on ${a.waitingOn})` : ''}`, { size: 9.5, bold: true })
      for (const d of a.decisions) {
        write(`Step ${d.step}: ${d.decision} by ${d.by}, ${d.at}${d.comment ? `. "${d.comment}"` : ''}`, { size: 9, color: MUTED, x: PAGE.left + 10, width: width - 10 })
      }
      gap(5); left()
    }
  }

  if (model.csat) {
    section('Customer rating')
    write(`${model.csat.rating} out of 5${model.csat.comment ? `  -  "${model.csat.comment}"` : ''}`, { size: 9.5 })
    left()
  }

  if (model.attachments.length > 0) {
    section('Attachments (names only)', model.attachments.length)
    for (const x of model.attachments) {
      ensure(16); left()
      write(`${x.name}  (${x.size})${x.by ? `  -  ${x.by}` : ''}, ${x.at}`, { size: 9, width })
    }
    left()
  }

  section('History', model.history.length)
  for (const h of model.history) {
    const line = `${h.at}  -  ${h.text}  (${h.by})${h.note ? `  -  ${h.note}` : ''}`
    ensure(heightOf(line, 9, width) + 3); left()
    write(line, { size: 9 })
  }

  // ── Footer on every page: who made it, when, and the page number ──
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const margins = doc.page.margins
    doc.page.margins.bottom = 0 // writing in the bottom margin must not start a new page
    doc.font('regular').fontSize(8).fillColor(MUTED)
    const y = doc.page.height - 34
    doc.text(`${model.requestNo}  |  Downloaded by ${model.generatedBy} on ${model.generatedAt}`, PAGE.left, y, { width: width - 70, lineBreak: false })
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.left + width - 70, y, { width: 70, align: 'right', lineBreak: false })
    doc.page.margins = margins
  }

  doc.end()
  return done
}
