import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// QA-D020: the data service cuts every single response at 1000 rows without any error. An export that asks for "limit 10001" in one go therefore stops at 1,000 rows
// and looks complete. Every export must read in pages (fetchAllPages), as the approvals export already did (D-021).
const src = readFileSync(path.resolve(__dirname, '..', '..', 'lib', 'export', 'reports.ts'), 'utf8')

describe('exports read in pages', () => {
  it('no export asks for its whole result in one request', () => {
    expect(src).not.toMatch(/\.limit\(MAX_EXPORT_ROWS \+ 1\)/)
  })
  it('requests, tasks, projects, stores and approvals all use fetchAllPages', () => {
    expect((src.match(/fetchAllPages</g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
