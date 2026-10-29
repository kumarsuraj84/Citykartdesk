// The conversation note "Ticket sent to the AC / Genset OEM" (written by masterSentComment) is plain text. This reads it back into parts, so the ticket page can show the
// table of the mail as a table. Pure (no React, no database). A note that does not have the expected shape gives null and is shown as plain text, as before.
//
// Shape of the note (the mail's table rows are "Label | value"; the further lines of a value are indented by two spaces, so a row never runs into the text below it):
//   Ticket sent to the AC OEM for servicing.
//
//   Subject: ...
//   To: ...
//   CC: ...
//
//   Message sent:
//   Dear Team,
//   Ticket No | CKSD-000001
//   Issue Description | first line
//     second line
//
//   Thanks and Regards,
//   Citykart Team

export const OEM_COMMENT_MARKER = 'Message sent:'

export type OemCommentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: { label: string; value: string }[] }

export type OemCommentView = {
  heading: string
  meta: { label: string; value: string }[]
  blocks: OemCommentBlock[]
}

const HEADING = /^Ticket sent to the (?:AC|Genset) OEM for servicing\.$/
const META = /^(Subject|To|CC): ?(.*)$/
const ROW = /^(\S[^|\n]{0,60}?) \|(?: (.*))?$/

export function parseOemComment(body: string): OemCommentView | null {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  if (!HEADING.test(lines[0] ?? '')) return null
  const at = lines.indexOf(OEM_COMMENT_MARKER)
  if (at < 0) return null

  const meta: { label: string; value: string }[] = []
  for (const l of lines.slice(1, at)) {
    const m = META.exec(l)
    if (m) meta.push({ label: m[1], value: m[2] })
  }

  const rest = lines.slice(at + 1)
  const blocks: OemCommentBlock[] = []
  let text: string[] = []
  let rows: { label: string; value: string }[] = []
  const flushText = () => { const t = text.join('\n').trim(); if (t) blocks.push({ kind: 'text', text: t }); text = [] }
  const flushRows = () => { if (rows.length) blocks.push({ kind: 'table', rows }); rows = [] }
  // a blank line belongs to the row above when the next non-blank line is still indented (the value has an empty line inside)
  const continues = (i: number) => { for (let j = i + 1; j < rest.length; j++) { if (rest[j].trim() === '') continue; return rest[j].startsWith('  ') } return false }

  for (let i = 0; i < rest.length; i++) {
    const line = rest[i]
    const row = ROW.exec(line)
    if (row) { flushText(); rows.push({ label: row[1].trim(), value: row[2] ?? '' }); continue }
    if (rows.length && (line.startsWith('  ') || (line.trim() === '' && continues(i)))) {
      rows[rows.length - 1].value += '\n' + line.slice(2)
      continue
    }
    if (rows.length) flushRows()
    if (line.trim() === '') { text.push(''); continue }
    text.push(line)
  }
  flushText(); flushRows()
  for (const b of blocks) if (b.kind === 'table') for (const r of b.rows) r.value = r.value.replace(/\s+$/, '')
  if (!blocks.some((b) => b.kind === 'table')) return null
  return { heading: lines[0], meta, blocks }
}
