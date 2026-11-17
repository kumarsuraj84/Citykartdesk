// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { useModalA11y } from '@/components/ui/useModalA11y'

// QA 2026-11 UI-010: a pop-up whose first box has autoFocus (Invite User, ...) took focus BEFORE the hook looked where focus was, so on close
// focus went to nothing (the page top) instead of back to the button that opened it. A keyboard / screen-reader user lost their place.
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Page() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </>
  )
}
function Dialog({ onClose }: { onClose: () => void }) {
  const d = useModalA11y({ onClose, label: 'Invite' })
  return <div {...d.props}><input aria-label="Name" autoFocus /><button onClick={onClose}>Close</button></div>
}

describe('pop-up gives focus back to the button that opened it, also when its first box has autoFocus', () => {
  it('Escape', () => {
    render(<Page />)
    const opener = screen.getByText('Open it'); opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))   // autoFocus took focus
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
  it('the Close button', () => {
    render(<Page />)
    const opener = screen.getByText('Open it'); opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByText('Close'))
    expect(document.activeElement).toBe(opener)
  })
})
