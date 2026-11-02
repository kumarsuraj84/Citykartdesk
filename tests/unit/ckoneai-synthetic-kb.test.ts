import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The synthetic demonstration articles must always carry their label and a complete, unapproved front matter, so they can never be mistaken for approved knowledge.
const dir = path.join(__dirname, '../../docs/ckoneai-desk/evidence/fixtures/synthetic-kb')
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
const parse = (t: string) => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(t.replace(/\r\n/g, '\n'))
  if (!m) throw new Error('no front matter')
  const fm: Record<string, string> = {}
  for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '') }
  return { fm, body: m[2] }
}

describe('synthetic demonstration knowledge', () => {
  it('has the ten articles', () => { expect(files.length).toBe(10) })

  it.each(files)('%s is labelled synthetic, not approved, and complete', (f) => {
    const { fm, body } = parse(readFileSync(path.join(dir, f), 'utf8'))
    expect(fm.status).toBe('SYNTHETIC-NOT-APPROVED')
    expect(fm.label).toMatch(/SYNTHETIC/)
    expect(fm.label).toMatch(/NEVER PROMOTE TO PRODUCTION/)
    expect(fm.approved_by).toBe('none')
    expect(['all', 'requester', 'technician', 'manager', 'admin']).toContain(fm.audience)
    expect(['app_help', 'catalogue', 'sla', 'approvals', 'vendor', 'analytics']).toContain(fm.domain)
    expect(fm.language).toBe('en')
    expect(['how_to', 'reference', 'policy']).toContain(fm.type)
    expect(fm.title.length).toBeGreaterThan(5)
    expect(body).toMatch(/SYNTHETIC DEMONSTRATION ARTICLE/)
    expect(body.length).toBeGreaterThan(200)
  })

  it('has unique ids, and no server name, address, secret or personal data', () => {
    const all = files.map((f) => readFileSync(path.join(dir, f), 'utf8'))
    const ids = all.map((t) => parse(t).fm.id)
    expect(new Set(ids).size).toBe(files.length)
    for (const t of all) {
      expect(t).not.toMatch(/\b10\.0\.\d+\.\d+\b|182\.72|supabase|password|token|secret/i)
      expect(t).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/)
    }
  })
})
