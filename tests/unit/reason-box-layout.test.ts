// Layout rules for the small reason boxes (status change, sub-category change) found in the 19 Nov 2026 report:
//  * an error line ABOVE the buttons pushed the buttons down by a line, so the next click on the same spot landed on "Attach a file" and opened the file picker;
//  * the status menu stayed open behind the reason box and came back after Cancel;
//  * the Attach button and the reply-box buttons were squeezed so far that their words broke letter by letter.
// These are checked in the source because the shift only shows in a real layout (it was also measured in the browser: the buttons now stay at the same y after the error appears).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8').replace(/\r\n/g, '\n')
const sidebar = read('components/requests/RequestSidebarPanel.tsx')
const attach = read('components/requests/useAttachFiles.tsx')
const comment = read('components/requests/CommentForm.tsx')

describe('reason boxes in the ticket sidebar', () => {
  it('the status reason box shows its error UNDER the buttons', () => {
    const buttons = sidebar.indexOf('onClick={confirmPendingComment}')
    const cancel = sidebar.indexOf('setPendingComment(null); setPendingCommentText', buttons)
    const error = sidebar.indexOf('{pendingCommentError &&', buttons)
    expect(buttons).toBeGreaterThan(0)
    expect(cancel).toBeGreaterThan(buttons)
    expect(error).toBeGreaterThan(cancel)
    // and nothing that toggles with the error sits above the buttons (the hint used to disappear when the error appeared)
    expect(sidebar).not.toMatch(/pendingComment\.hint && !pendingCommentError/)
  })

  it('the sub-category reason box shows its error UNDER the buttons', () => {
    const buttons = sidebar.indexOf('onClick={confirmPick}')
    const cancel = sidebar.indexOf('onClick={cancelPick}', buttons)
    const error = sidebar.indexOf('{reasonError &&', buttons)
    expect(buttons).toBeGreaterThan(0)
    expect(cancel).toBeGreaterThan(buttons)
    expect(error).toBeGreaterThan(cancel)
    expect(sidebar.slice(0, buttons)).not.toMatch(/\{reasonError &&[^\n]*\n[^\n]*<div className="flex flex-wrap gap-2">/)
  })

  it('the status menu is closed as soon as a choice is made, so it cannot stay open behind the reason box', () => {
    const pick = sidebar.indexOf('function pick(next: RequestStatus) {')
    expect(sidebar.slice(pick, pick + 80)).toContain('setOpen(false)')
  })

  it('the confirm button can wrap its long words instead of pushing Cancel out of the box', () => {
    expect(sidebar).toMatch(/onClick=\{confirmPendingComment\}[^>]*!whitespace-normal/)
    expect(sidebar).toMatch(/onClick=\{confirmPick\}[^>]*!whitespace-normal/)
    expect(sidebar.match(/<div className="flex flex-wrap gap-2">/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('the Attach controls', () => {
  it('"Attach a file" keeps its words on one line and the hint wraps beside or below it', () => {
    expect(attach).toMatch(/inline-flex shrink-0 [^"]*whitespace-nowrap/)
    expect(attach).toContain('flex flex-wrap items-center')
  })
  it('the reply box buttons wrap onto a new row instead of being squeezed into each other', () => {
    expect(comment).toContain('flex flex-wrap items-center justify-between')
    expect(comment.match(/shrink-0[^"`]*whitespace-nowrap|whitespace-nowrap[^"`]*shrink-0/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
