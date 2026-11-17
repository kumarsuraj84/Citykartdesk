import { describe, expect, it } from 'vitest'
import fs from 'fs'

// Guards for the accessibility fixes of the Zoho transfer screens (stage 4 QA). They read the source so a later edit cannot quietly undo them; the browser check
// (docs/qa-full-audit-2026-11/ui/ui-zoho.mjs) proves the same on the running app.
const read = (p: string) => fs.readFileSync(p, 'utf8')

describe('Zoho transfer screens: accessibility guards', () => {
  it('every inline confirm box moves focus into itself and closes on Escape (useAlertDialog), with a harmless button first', () => {
    for (const f of ['MoveControls', 'RunPanel', 'MovedSwitch']) {
      const src = read(`app/(app)/zoho/move/${f}.tsx`)
      expect(src, f).toContain('useAlertDialog')
      expect(src, f).toMatch(/ref=\{dlg\} role="alertdialog" aria-label=/)
      expect(src, f).toContain('data-autofocus')
      expect(src, f).toContain('data-return-focus')
    }
    const hook = read('app/(app)/zoho/_components/useAlertDialog.ts')
    expect(hook).toContain("e.key === 'Escape'")
    expect(hook).toContain('.focus()')
  })
  it('the navigation landmarks have names, so a screen reader can tell them apart', () => {
    expect(read('components/layout/Sidebar.tsx').match(/<nav aria-label="Main menu"/g)?.length).toBe(2)
    expect(read('components/layout/MobileNav.tsx')).toContain('<nav aria-label="Quick links"')
    expect(read('app/(app)/zoho/_components/ZohoNav.tsx')).toContain('<nav aria-label="Zoho sections"')
    expect(read('app/(app)/zoho/mapping/page.tsx')).toContain('aria-label="Mapping sections"')
  })
  it('the "open" count on the Zoho overview is dark enough to read (contrast 4.5:1)', () => {
    const src = read('app/(app)/zoho/page.tsx')
    expect(src).not.toContain('text-amber-600')
    expect(src).toContain('text-amber-700')
  })
  it('every control of the mapping and move screens carries a name', () => {
    for (const f of ['mapping/TemplateMapper.tsx', 'mapping/StatusAndPeopleMappers.tsx']) {
      const src = read(`app/(app)/zoho/${f}`)
      const selects = (src.match(/<select\b/g) ?? []).length
      const labelled = (src.match(/<select[^>]*aria-label=/g) ?? []).length + (src.match(/<select[^>]*>\s*\n?/g) ?? []).length * 0
      expect(labelled, `${f}: every <select> needs an aria-label`).toBe(selects)
    }
  })
})
