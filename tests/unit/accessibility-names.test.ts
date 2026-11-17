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

// QA 2026-11 (full audit, UI-001..UI-005): axe-core over 564 page views found controls without a name on admin screens, public pages without a main landmark and
// sideways-scrolling tables the keyboard could not reach. Static guards (the running-app check is docs/qa-full-audit-2026-11/ui/ui-a11y-regress.mjs).
describe('QA 2026-11 accessibility fixes', () => {
  it('the public pages (sign in, forgot/reset password, rating, e-mail approval) sit inside one main landmark', () => {
    for (const f of [['app', '(auth)', 'layout.tsx'], ['app', 'csat', 'layout.tsx'], ['app', 'approve', 'layout.tsx']]) expect(read(...f), f.join('/')).toMatch(/<main>\{children\}<\/main>/)
  })
  it('the date, select and icon controls of the admin screens carry a name', () => {
    const need: [string[], RegExp[]][] = [
      [['app', '(app)', 'admin', 'logs', 'AuditLogClient.tsx'], [/aria-label="Entity type"/, /aria-label="Actor"/, /aria-label="Date from"/, /aria-label="Date to"/]],
      [['app', '(app)', 'admin', 'reports', 'page.tsx'], [/aria-label="Report from date"/, /aria-label="Report to date"/]],
      [['app', '(app)', 'admin', 'stuck-tickets', 'WrongTechnicianSection.tsx'], [/aria-label="Technician to hand the tickets over to"/]],
      [['app', '(app)', 'intake', 'inbox', 'InboxList.tsx'], [/aria-label="Sort messages"/]],
      [['app', '(app)', 'intake', 'settings', 'ReclassifyButton.tsx'], [/aria-label="Only messages from this date"/]],
      [['app', '(app)', 'admin', 'approvals', 'WorkflowBuilderClient.tsx'], [/aria-label=\{expanded \? 'Collapse workflow' : 'Expand workflow'\}/]],
      [['app', '(app)', 'admin', 'master-data', 'MasterDataClient.tsx'], [/aria-label="Move up"/, /aria-label="Move down"/]],
      [['app', '(app)', 'admin', 'task-config', 'TaskConfigClient.tsx'], [/aria-label="Move up"/, /aria-label="Move down"/, /aria-label=\{`Colour \$\{c\}`\}/, /role="switch"/, /aria-label=\{`Delete \$\{s\.name\}`\}/, /aria-label=\{`Delete \$\{p\.name\}`\}/]],
      [['app', '(app)', 'admin', 'task-config', 'TaskTemplatesClient.tsx'], [/aria-label="Delete template"/]],
      [['components', 'analytics', 'DetailDrawer.tsx'], [/aria-label="Close details"/, /inert=\{!open\}/]],
    ]
    for (const [file, res] of need) { const src = read(...file); for (const re of res) expect(src, `${file.join('/')} ${re}`).toMatch(re) }
  })
  it('every move up / move down button of the task settings has a name (none left without)', () => {
    const src = read('app', '(app)', 'admin', 'task-config', 'TaskConfigClient.tsx')
    for (const m of src.matchAll(/<button\b[^>]*onClick=\{\(\) => move\(i, -?1\)\}[\s\S]*?>/g)) expect(m[0], m[0]).toMatch(/aria-label="Move (up|down)"/)
  })
  it('the tables that scroll sideways on a phone can be reached from the keyboard', () => {
    for (const [f, re] of [[['app', '(app)', 'zoho', 'page.tsx'], /tabIndex=\{0\} role="region"/], [['app', '(app)', 'zoho', 'reports', 'page.tsx'], /tabIndex=\{0\} role="region"/], [['app', '(app)', 'zoho', 'tickets', 'page.tsx'], /tabIndex=\{0\} role="region"/],
      [['app', '(app)', 'admin', 'logs', 'AuditLogClient.tsx'], /tabIndex=\{0\} role="region"/], [['app', '(app)', 'admin', 'logs', 'EventLogClient.tsx'], /tabIndex=\{0\} role="region"/], [['app', '(app)', 'admin', 'logs', 'SystemLogClient.tsx'], /tabIndex=\{0\} role="region"/],
      [['components', 'tasks', 'TaskTable.tsx'], /tabIndex=\{0\} role="region"/], [['app', '(app)', 'admin', 'reports', 'AnalyticsDashboard.tsx'], /tabIndex=\{0\} role="region"/]] as [string[], RegExp][]) expect(read(...f), f.join('/')).toMatch(re)
  })
  it('the runbooks page has no second main landmark inside the app shell, and Runbooks and Tasks each have a page heading', () => {
    const rb = read('app', '(app)', 'admin', 'runbooks', 'RunbooksClient.tsx')
    expect(rb).not.toMatch(/<main\b/)
    expect(rb).toMatch(/<h1 className="sr-only">Runbooks<\/h1>/)
    expect(read('app', '(app)', 'tasks', 'page.tsx')).toMatch(/<h1 className="sr-only">Tasks<\/h1>/)
  })
})

describe('QA 2026-11 sign-in errors and skip link (UI-008, UI-009)', () => {
  it('the error boxes of sign in, forgot password and reset password are announced to a screen reader (role=alert)', () => {
    for (const [f, n] of [[['app', '(auth)', 'login', 'page.tsx'], 2], [['app', '(auth)', 'forgot-password', 'page.tsx'], 1], [['app', '(auth)', 'reset-password', 'page.tsx'], 2]] as [string[], number][]) {
      const src = read(...f)
      expect([...src.matchAll(/<div role="alert" className="[^"]*bg-destructive\/10/g)].length, f.join('/')).toBe(n)
      expect(src, f.join('/') + ' has an error box without role=alert').not.toMatch(/<div className="[^"]*bg-destructive\/10/)
    }
  })
  it('the app has a skip link to the main area', () => {
    const src = read('components', 'layout', 'AppShell.tsx')
    expect(src).toMatch(/href="#main-content"[^>]*>Skip to main content<\/a>/)
    expect(src).toMatch(/<main id="main-content" tabIndex=\{-1\}/)
  })
})
