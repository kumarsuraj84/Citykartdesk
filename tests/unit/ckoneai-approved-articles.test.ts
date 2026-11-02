import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The help articles in docs/knowledge-base-drafts/. Only an article with status APPROVED may ever be given to the assistant, so an approved article must be complete:
// a named approver, an approval date, a version and a review date, and it must carry no server name, secret or personal data.
const dir = path.join(__dirname, '../../docs/knowledge-base-drafts')
const files = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort()
const parse = (t: string) => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(t.replace(/\r\n/g, '\n'))
  if (!m) throw new Error('no front matter')
  const fm: Record<string, string> = {}
  for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '') }
  return { fm, body: m[2] }
}

describe('the help articles', () => {
  it('has the first set of eight', () => { expect(files.length).toBe(8) })

  it.each(files)('%s is complete (an APPROVED article names its approver, date, version and review date)', (f) => {
    const { fm, body } = parse(readFileSync(path.join(dir, f), 'utf8'))
    expect(['APPROVED', 'DRAFT-NOT-APPROVED']).toContain(fm.status)
    expect(['how_to', 'reference', 'policy']).toContain(fm.type)
    expect(['all', 'requester', 'technician', 'manager', 'admin']).toContain(fm.audience)
    expect(fm.language).toBe('en')
    expect(fm.title.length).toBeGreaterThan(5)
    expect(body.length).toBeGreaterThan(200)
    if (fm.status === 'APPROVED') {
      expect(fm.approved_by).toMatch(/\S/)
      expect(fm.approved_by).not.toBe('none')
      expect(fm.approved_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number(fm.version)).toBeGreaterThanOrEqual(1)
      expect(fm.review_by).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(fm.review_by > fm.approved_on).toBe(true)
    }
  })

  it('has unique ids and no server name, address, secret or personal data', () => {
    const all = files.map((f) => readFileSync(path.join(dir, f), 'utf8'))
    expect(new Set(all.map((t) => parse(t).fm.id)).size).toBe(files.length)
    for (const t of all) {
      expect(t).not.toMatch(/\b10\.0\.\d+\.\d+\b|182\.72|supabase|password|token|secret/i)
      expect(t).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/)
    }
  })
})
