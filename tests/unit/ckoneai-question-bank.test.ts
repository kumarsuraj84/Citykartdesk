import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The CKDesk assistant question bank (docs/ckoneai-desk/evidence/fixtures/question-bank.json). It is data for the CKOneAI session to run against its tools;
// this test only keeps the file well-formed and wide enough, so it cannot silently shrink or lose a category.
type Item = { id: string; category: string; question: string; role: string; language: string; period: string | null; phase: string; expected_tool?: string; expected_refusal?: string; note: string }
const bank = JSON.parse(readFileSync(path.join(__dirname, '../../docs/ckoneai-desk/evidence/fixtures/question-bank.json'), 'utf8')) as { tools: string[]; refusal_reasons: string[]; items: Item[] }
const items = bank.items

describe('CKDesk assistant question bank', () => {
  it('has at least 150 scenarios with unique ids and unique role+question pairs', () => {
    expect(items.length).toBeGreaterThanOrEqual(150)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(new Set(items.map((i) => `${i.role}|${i.question}`)).size).toBe(items.length)
  })

  it('every item has exactly one expectation: a known tool, or a known refusal reason', () => {
    for (const i of items) {
      expect(Boolean(i.expected_tool) !== Boolean(i.expected_refusal), i.id).toBe(true)
      if (i.expected_tool) expect(bank.tools, i.id).toContain(i.expected_tool)
      if (i.expected_refusal) expect(bank.refusal_reasons, i.id).toContain(i.expected_refusal)
      expect(['requester', 'technician', 'approver', 'manager', 'orgwide'], i.id).toContain(i.role)
      expect(['en', 'hinglish'], i.id).toContain(i.language)
      expect(['now', 'knowledge'], i.id).toContain(i.phase)
      expect(i.question.trim().length, i.id).toBeGreaterThan(5)
    }
  })

  it('covers every tool, every role, Hinglish and the refusal families the owner asked for', () => {
    for (const t of bank.tools) expect(items.some((i) => i.expected_tool === t), t).toBe(true)
    for (const r of ['requester', 'technician', 'approver', 'manager', 'orgwide']) expect(items.some((i) => i.role === r), r).toBe(true)
    expect(items.filter((i) => i.language === 'hinglish').length).toBeGreaterThanOrEqual(25)
    for (const reason of ['role_not_allowed', 'not_own_data', 'approvals_waiting_not_available', 'read_only', 'out_of_domain', 'prompt_injection', 'ask_clarification', 'unknown_ticket', 'docs_not_in_scope', 'hierarchy_not_ready'])
      expect(items.some((i) => i.expected_refusal === reason), reason).toBe(true)
    expect(items.filter((i) => i.period).length).toBeGreaterThanOrEqual(15)
  })

  it('the how-to questions are marked as needing the document scope, which is not approved yet', () => {
    const howto = items.filter((i) => i.category.startsWith('howto_'))
    expect(howto.length).toBeGreaterThanOrEqual(25)
    for (const i of howto) { expect(i.phase).toBe('knowledge'); expect(i.expected_refusal).toBe('docs_not_in_scope') }
  })

  it('contains no real-looking personal data (e-mail, 10-digit phone)', () => {
    const text = JSON.stringify(items)
    expect(text).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/)
    expect(text).not.toMatch(/\b[6-9]\d{9}\b/)
  })
})
