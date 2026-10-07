// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

vi.mock('@/lib/actions/requests', () => ({ updateRequestFormData: vi.fn() }))

import { copyText } from '@/lib/clipboard'
import { SubmittedFieldRow } from '@/components/requests/SubmittedFieldRow'
import type { FormField } from '@/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const phoneField = { id: 'f1', label: 'Contact Number', type: 'text', order: 1 } as unknown as FormField

describe('copyText', () => {
  it('uses the modern clipboard on a secure origin', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    expect(await copyText('2321312321')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('2321312321')
  })

  it('falls back to select-and-copy on plain http, where navigator.clipboard does not exist', async () => {
    vi.stubGlobal('navigator', {})
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    ;(document as unknown as { execCommand: typeof exec }).execCommand = exec
    expect(await copyText('21212')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelectorAll('textarea').length).toBe(0) // temporary field is removed again
  })

  it('reports failure instead of throwing when nothing works', async () => {
    vi.stubGlobal('navigator', {})
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    ;(document as unknown as { execCommand: () => never }).execCommand = () => { throw new Error('blocked') }
    expect(await copyText('x')).toBe(false)
  })
})

describe('side-panel form field row', () => {
  it('a value the technician cannot edit is plain selectable text, not a button', () => {
    render(<SubmittedFieldRow requestId="r1" field={phoneField} value="2321312321" canEdit={false} />)
    const value = screen.getByText('2321312321')
    expect(value.closest('button')).toBeNull()
    expect(value.className).toContain('select-text')
  })

  it('an editable value keeps its edit button', () => {
    render(<SubmittedFieldRow requestId="r1" field={phoneField} value="2321312321" canEdit />)
    expect(screen.getByText('2321312321').closest('button')).not.toBeNull()
  })

  it('has a copy button that copies exactly the shown value', async () => {
    vi.stubGlobal('navigator', {})
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    ;(document as unknown as { execCommand: typeof exec }).execCommand = exec
    let copiedText = ''
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'textarea') Object.defineProperty(el, 'select', { value: () => { copiedText = (el as HTMLTextAreaElement).value } })
      return el
    }) as typeof document.createElement)

    render(<SubmittedFieldRow requestId="r1" field={phoneField} value="2321312321" canEdit={false} />)
    await act(async () => { fireEvent.click(screen.getByLabelText('Copy Contact Number')) })
    expect(copiedText).toBe('2321312321')
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('shows no copy button for an empty value', () => {
    render(<SubmittedFieldRow requestId="r1" field={phoneField} value="" canEdit={false} />)
    expect(screen.queryByLabelText('Copy Contact Number')).toBeNull()
  })
})
