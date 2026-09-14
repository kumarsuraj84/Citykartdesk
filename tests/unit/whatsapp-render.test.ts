import { describe, it, expect } from 'vitest'
import { renderConversationResult } from '@/lib/whatsapp/render'
import { WHATSAPP_BUTTON_TITLE_MAX, WHATSAPP_LIST_MAX_ROWS, WHATSAPP_ROW_TITLE_MAX } from '@/lib/whatsapp/types'
import type { ConversationResult } from '@/lib/conversations'

function withPrompt(prompt: ConversationResult['prompt']): ConversationResult {
  return { conversationId: 'c1', state: 'awaiting_service', prompt }
}

describe('Stage 5 — ConversationResult -> WhatsApp render (Step 33)', () => {
  it('renders service_selection with <=3 options as an interactive button message', () => {
    const [message] = renderConversationResult(withPrompt({ type: 'service_selection', message: 'Choose:', options: [{ id: 's1', label: 'IT' }, { id: 's2', label: 'HR' }] }))
    expect(message).toMatchObject({ type: 'interactive', interactive: { type: 'button' } })
    if (message.type === 'interactive' && message.interactive.type === 'button') {
      expect(message.interactive.action.buttons).toHaveLength(2)
      expect(message.interactive.action.buttons[0].reply.id).toBe('s1')
    }
  })

  it('renders service_selection with 4-10 options as a single list message', () => {
    const options = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, label: `Service ${i}` }))
    const messages = renderConversationResult(withPrompt({ type: 'service_selection', options }))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'interactive', interactive: { type: 'list' } })
    if (messages[0].type === 'interactive' && messages[0].interactive.type === 'list') {
      expect(messages[0].interactive.action.sections[0].rows).toHaveLength(5)
    }
  })

  it('paginates more than 10 options across multiple list messages, never dropping any option', () => {
    const options = Array.from({ length: 23 }, (_, i) => ({ id: `s${i}`, label: `Service ${i}` }))
    const messages = renderConversationResult(withPrompt({ type: 'service_selection', options }))
    expect(messages).toHaveLength(3) // 10 + 10 + 3
    const allRowIds = messages.flatMap((m) => (m.type === 'interactive' && m.interactive.type === 'list' ? m.interactive.action.sections[0].rows.map((r) => r.id) : []))
    expect(allRowIds).toHaveLength(23)
    expect(new Set(allRowIds).size).toBe(23) // every option present exactly once
    for (const m of messages) {
      if (m.type === 'interactive' && m.interactive.type === 'list') {
        expect(m.interactive.action.sections[0].rows.length).toBeLessThanOrEqual(WHATSAPP_LIST_MAX_ROWS)
      }
    }
  })

  it('truncates a row title longer than the Meta-documented 24-character limit', () => {
    const longLabel = 'A'.repeat(40)
    const options = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, label: i === 0 ? longLabel : `Service ${i}` }))
    const [message] = renderConversationResult(withPrompt({ type: 'service_selection', options }))
    if (message.type === 'interactive' && message.interactive.type === 'list') {
      expect(message.interactive.action.sections[0].rows[0].title.length).toBeLessThanOrEqual(WHATSAPP_ROW_TITLE_MAX)
    }
  })

  it('truncates a button title longer than the 20-character limit', () => {
    const longLabel = 'B'.repeat(40)
    const [message] = renderConversationResult(withPrompt({ type: 'select', options: [{ id: 'o1', label: longLabel }] }))
    if (message.type === 'interactive' && message.interactive.type === 'button') {
      expect(message.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(WHATSAPP_BUTTON_TITLE_MAX)
    }
  })

  it('renders issue_search as plain text with an example', () => {
    const [message] = renderConversationResult(withPrompt({ type: 'issue_search' }))
    expect(message).toMatchObject({ type: 'text' })
    if (message.type === 'text') expect(message.text.body.toLowerCase()).toContain('printer')
  })

  it('renders subcategory_selection using the same option-list machinery (canonical ids preserved)', () => {
    const [message] = renderConversationResult(withPrompt({ type: 'subcategory_selection', options: [{ id: 'uuid-1', label: 'Printer Issue' }] }))
    if (message.type === 'interactive' && message.interactive.type === 'button') {
      expect(message.interactive.action.buttons[0].reply.id).toBe('uuid-1')
    }
  })

  it('renders a text/date/number/file prompt as plain text', () => {
    for (const type of ['text', 'date', 'number', 'file'] as const) {
      const [message] = renderConversationResult(withPrompt({ type, message: 'Prompt label' }))
      expect(message.type).toBe('text')
    }
  })

  it('renders multiselect as a numbered free-text prompt, never silently reduced to single-select', () => {
    const options = [{ id: 'hardware', label: 'Hardware' }, { id: 'software', label: 'Software' }, { id: 'network', label: 'Network' }]
    const [message] = renderConversationResult(withPrompt({ type: 'multiselect', message: 'Pick affected areas', options }))
    expect(message.type).toBe('text')
    if (message.type === 'text') {
      expect(message.text.body).toContain('1. Hardware')
      expect(message.text.body).toContain('2. Software')
      expect(message.text.body).toContain('3. Network')
      expect(message.text.body.toLowerCase()).toContain('comma')
    }
  })

  it('renders a ready review with Create/Cancel buttons carrying cmd: prefixed ids', () => {
    const messages = renderConversationResult(withPrompt({
      type: 'review',
      review: { serviceName: 'IT', subCategoryName: 'Printer Issue', description: 'desc', title: 'Subject', fields: [{ fieldId: 'f1', label: 'Location', displayValue: 'Counter 2' }], ready: true, missingFields: [], invalidFields: [] },
    }))
    const buttonMessage = messages.find((m) => m.type === 'interactive')
    expect(buttonMessage).toBeTruthy()
    if (buttonMessage?.type === 'interactive' && buttonMessage.interactive.type === 'button') {
      const ids = buttonMessage.interactive.action.buttons.map((b) => b.reply.id)
      expect(ids).toContain('cmd:create')
      expect(ids).toContain('cmd:cancel')
    }
  })

  it('renders a not-ready review WITHOUT a Create button (never lets the user try to submit early)', () => {
    const messages = renderConversationResult(withPrompt({
      type: 'review',
      review: { serviceName: 'IT', subCategoryName: null, description: null, title: 'Subject', fields: [], ready: false, missingFields: [{ key: 'f1', label: 'Location' }], invalidFields: [] },
    }))
    expect(messages.some((m) => m.type === 'interactive')).toBe(false)
    expect(messages[0]).toMatchObject({ type: 'text' })
  })

  it('renders completed with the exact confirmation message and a Start New button', () => {
    const messages = renderConversationResult(withPrompt({ type: 'completed', message: 'Your request has been created (CKSD-000123).' }))
    expect(messages[0]).toMatchObject({ type: 'text', text: { body: 'Your request has been created (CKSD-000123).' } })
    const buttons = messages.find((m) => m.type === 'interactive')
    if (buttons?.type === 'interactive' && buttons.interactive.type === 'button') {
      expect(buttons.interactive.action.buttons[0].reply.id).toBe('cmd:new')
    }
  })

  it('renders cancelled and expired with a Start New option', () => {
    for (const type of ['cancelled', 'expired'] as const) {
      const messages = renderConversationResult(withPrompt({ type, message: 'done' }))
      expect(messages.some((m) => m.type === 'text')).toBe(true)
      expect(messages.some((m) => m.type === 'interactive')).toBe(true)
    }
  })

  it('renders active_draft_exists options (restart/cancel) with cmd: prefixed ids', () => {
    const [message] = renderConversationResult(withPrompt({
      type: 'active_draft_exists',
      message: 'You already have a request in progress.',
      options: [{ id: 'restart', label: 'Restart' }, { id: 'cancel', label: 'Cancel' }],
    }))
    if (message.type === 'interactive' && message.interactive.type === 'button') {
      expect(message.interactive.action.buttons.map((b) => b.reply.id)).toEqual(['cmd:restart', 'cmd:cancel'])
    }
  })

  it('renders a bare error prompt as plain text', () => {
    const [message] = renderConversationResult(withPrompt({ type: 'error', message: 'No request in progress to cancel.' }))
    expect(message).toMatchObject({ type: 'text', text: { body: 'No request in progress to cancel.' } })
  })

  it('renders an error WITH the original prompt shape (e.g. select) by repeating the same options, never advancing the user', () => {
    const messages = renderConversationResult(withPrompt({ type: 'select', message: 'Please select one of the available options.', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }))
    if (messages[0].type === 'interactive' && messages[0].interactive.type === 'button') {
      expect(messages[0].interactive.action.buttons).toHaveLength(2)
    }
  })

  it('returns an empty array when there is no prompt at all', () => {
    expect(renderConversationResult({ conversationId: 'c1', state: 'identified' })).toEqual([])
  })
})
