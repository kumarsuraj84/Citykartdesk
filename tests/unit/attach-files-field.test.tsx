// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { AttachFilesField, useAttachFiles } from '@/components/requests/useAttachFiles'

// The optional "attach a file" part of the message asked when a technician changes a ticket's status: Attach button, Ctrl+V of a screenshot, drag and drop.
afterEach(() => cleanup())

function Box() {
  const a = useAttachFiles()
  return (
    <div onDrop={a.onDrop} onDragOver={(e) => e.preventDefault()}>
      <textarea aria-label="message" onPaste={a.onPaste} />
      <AttachFilesField files={a.files} problem={a.problem} addFiles={a.addFiles} removeAt={a.removeAt} />
      <output aria-label="count">{a.files.length}</output>
    </div>
  )
}

const png = (name = 'image.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])], name, { type: 'image/png' })
const paste = (box: HTMLElement, files: File[], text = '') => fireEvent.paste(box, { clipboardData: { files, getData: (t: string) => (t === 'text/plain' ? text : '') } })
const count = () => screen.getByLabelText('count').textContent

describe('optional files on a status message', () => {
  it('says the files are optional and offers the Attach button', () => {
    render(<Box />)
    expect(screen.getByRole('button', { name: /Attach a file/ })).toBeTruthy()
    expect(screen.getByText(/optional/)).toBeTruthy()
  })

  it('Ctrl+V of a screenshot attaches it with a readable name; the list can remove it', async () => {
    render(<Box />)
    paste(screen.getByLabelText('message'), [png('image.png')])
    await waitFor(() => expect(count()).toBe('1'))
    expect(screen.getByLabelText('Files to attach').textContent).toMatch(/screenshot-\d{8}-\d{6}\.png/)
    fireEvent.click(screen.getByRole('button', { name: /^Remove screenshot-/ }))
    expect(count()).toBe('0')
  })

  it('pasted text is not turned into a file', async () => {
    render(<Box />)
    paste(screen.getByLabelText('message'), [], 'just words')
    await new Promise((r) => setTimeout(r, 20))
    expect(count()).toBe('0')
  })

  it('a file chosen with the Attach button is listed', async () => {
    render(<Box />)
    const input = screen.getByLabelText('Attach files (optional)') as HTMLInputElement
    fireEvent.change(input, { target: { files: [png('photo.png')] } })
    await waitFor(() => expect(count()).toBe('1'))
    expect(screen.getByText('photo.png')).toBeTruthy()
  })

  it('a file dropped on the box is attached', async () => {
    render(<Box />)
    fireEvent.drop(screen.getByLabelText('message'), { dataTransfer: { files: [png('dropped.png')], getData: () => '', types: ['Files'] } })
    await waitFor(() => expect(count()).toBe('1'))
  })

  it('a file type that is not allowed is refused with a reason and the good file next to it is kept', async () => {
    render(<Box />)
    paste(screen.getByLabelText('message'), [new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }), png('ok.png')])
    await waitFor(() => expect(count()).toBe('1'))
    expect(screen.getByRole('alert').textContent).toMatch(/setup\.exe/)
  })
})
