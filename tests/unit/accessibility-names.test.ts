import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// QA-D010 / D011: found with axe-core on the running app. Controls that show no words (a switch, an icon button, a select inside a table row) need a name a screen reader can say,
// and a sideways-scrolling table needs a way to be scrolled from the keyboard. Static guards so the names cannot be dropped again.
const read = (...p: string[]) => readFileSync(path.resolve(__dirname, '..', '..', ...p), 'utf8')

describe('accessible names', () => {
  it('the rule switches of Business Rules carry a name', () => {
    const src = read('app', '(app)', 'admin', 'business-rules', 'BusinessRulesClient.tsx')
    expect(src).toMatch(/aria-label=\{label\}/)
    for (const m of src.matchAll(/<Toggle\b[^>]*>/g)) expect(m[0], m[0]).toMatch(/label=/)
  })
  it('every select in a vendor person row carries a name', () => {
    const src = read('app', '(app)', 'admin', 'vendors', 'VendorsClient.tsx')
    const rowSelects = [...src.matchAll(/<select\b[^>]*h-8 rounded border[^>]*>/g)].map((m) => m[0])
    expect(rowSelects.length).toBe(2)
    for (const s of rowSelects) expect(s, s).toMatch(/aria-label=/)
  })
  it('the add-collaborator button of a ticket carries a name', () => {
    const src = read('components', 'requests', 'RequestSidebarPanel.tsx')
    expect(src).toMatch(/aria-label="Add a collaborator"/)
  })
  it('the vendor tables that scroll sideways can be reached from the keyboard', () => {
    for (const f of [['app', '(app)', 'vendor', 'page.tsx'], ['components', 'vendor', 'PoRegisterView.tsx']]) {
      const src = read(...f)
      const wrap = src.match(/<div className="overflow-x-auto rounded-xl border border-border"[^>]*>/)
      expect(wrap, f.join('/')).not.toBeNull()
      expect(wrap![0]).toMatch(/tabIndex=\{0\}/)
      expect(wrap![0]).toMatch(/aria-label=/)
    }
  })
  it('the small hint of the vendor status tiles is not faded below the readable contrast', () => {
    expect(read('app', '(app)', 'vendor', 'page.tsx')).not.toMatch(/text-\[10px\] opacity-70/)
  })
})

describe('readable small text', () => {
  it('the time of a ticket message is not faded to 2.8:1 contrast', () => {
    expect(read('app', '(app)', 'requests', '[id]', 'page.tsx')).not.toMatch(/text-\[11px\] text-muted-foreground\/70/)
  })
})

describe('Report Builder, calendar and mail editor names (QA-D012)', () => {
  const pivot = read('components', 'reports', 'PivotBuilder.tsx')
  it('every select, date input and icon-only button of the Report Builder carries a name', () => {
    for (const m of pivot.matchAll(/<select\b[^>]*>/g)) expect(m[0].replace(/\s+/g, ' '), m[0]).toMatch(/aria-label=/)
    for (const m of pivot.matchAll(/<input type="date"[^>]*>/g)) expect(m[0], m[0]).toMatch(/aria-label=/)
    expect(pivot).toMatch(/aria-label=\{`Options for/)
  })
  it('the scrolling report tables and the drill-down list can be reached from the keyboard', () => {
    for (const f of [['components', 'reports', 'FlatTableView.tsx'], ['components', 'executive', 'ExplorerSection.tsx']]) expect(read(...f)).toMatch(/overflow-auto[^>]*tabIndex=\{0\}/)
  })
  it('the ticket calendar is a labelled group, not a grid without rows', () => {
    expect(read('components', 'executive', 'TicketCalendarSection.tsx')).not.toMatch(/role="grid"/)
  })
  it('the rich mail editor has a name', () => {
    expect(read('components', 'admin', 'RichEmailEditor.tsx')).toMatch(/'aria-label': 'E-mail message'/)
  })
})

describe('technician group expander (QA-D012)', () => {
  it('the arrow that opens a group has a name and tells whether it is open', () => {
    expect(read('app', '(app)', 'admin', 'teams', 'TeamManagementClient.tsx')).toMatch(/setExpanded\(\(v\) => !v\)\} aria-expanded=\{expanded\} aria-label=/)
  })
})
