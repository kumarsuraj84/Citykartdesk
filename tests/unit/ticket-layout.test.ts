import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TICKET_TEXT_WRAP } from '@/lib/ui/ticket-layout'

// The ticket page must never be wider than the window: a long web address, serial number or pasted table in a comment or a form answer used to push it past
// the edge (up to 596 px on laptops, measured with real users). The fix is a layout rule, so these checks keep the rule in place.
const read = (p: string) => readFileSync(p, 'utf8')

describe('ticket page text wrapping', () => {
  it('uses overflow-wrap: anywhere (it also lowers the width a box asks for, unlike break-word)', () => {
    expect(TICKET_TEXT_WRAP).toBe('[overflow-wrap:anywhere]')
  })

  it('is set on the tab content and the title of the agent/requester ticket page', () => {
    expect(read('components/requests/RequestDetailTabs.tsx')).toMatch(/id="request-tab-panel"[\s\S]{0,200}TICKET_TEXT_WRAP/)
    expect(read('app/(app)/requests/[id]/page.tsx')).toMatch(/<h1 className=\{`[^`]*\$\{TICKET_TEXT_WRAP\}`\}>/)
  })

  it('is set on the content column and title of the OEM engineer ticket page, whose grid column may shrink', () => {
    const vendor = read('app/(app)/vendor/tickets/[id]/page.tsx')
    expect(vendor).toMatch(/<h1 className=\{`[^`]*\$\{TICKET_TEXT_WRAP\}`\}>/)
    expect(vendor).toMatch(/<div className=\{`space-y-4 \$\{TICKET_TEXT_WRAP\}`\}>/)
    expect(vendor).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]')   // a plain 1fr column cannot shrink below its widest word
    expect(vendor).not.toContain('lg:grid-cols-[1fr_20rem]')
  })

  it('does not let an explicit break-words override the rule in the boxes that show typed answers and comments', () => {
    // `break-words` (overflow-wrap: break-word) overrides the inherited value and keeps the box as wide as its longest word
    for (const f of ['components/requests/SubmittedFieldRow.tsx', 'components/requests/SubmittedDataPanel.tsx', 'components/requests/LinesComment.tsx', 'components/requests/OemSentComment.tsx']) {
      expect(read(f), f).not.toMatch(/\bbreak-words\b/)
    }
  })

  it('lets the header row of buttons and badges wrap on a narrow screen', () => {
    expect(read('app/(app)/requests/[id]/page.tsx')).toContain('className="mb-3 flex flex-wrap items-center justify-between gap-3"')
  })
})
