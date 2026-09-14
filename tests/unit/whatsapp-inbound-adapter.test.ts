import { describe, it, expect } from 'vitest'
import { mapMetaMessageToInbound } from '@/lib/whatsapp/inbound-adapter'
import { commandButtonId } from '@/lib/whatsapp/types'
import type { MetaMessage } from '@/lib/whatsapp/types'

const BASE = { orgId: 'org-1', requesterId: 'req-1', channelIdentity: '9876543210' }

function msg(partial: Partial<MetaMessage> & { id: string; type: string }): MetaMessage {
  return { from: '919876543210', timestamp: '1700000000', ...partial } as MetaMessage
}

describe('Stage 5 — Meta message -> ConversationInbound adapter', () => {
  it('maps a plain text message to kind:text', () => {
    const result = mapMetaMessageToInbound({ message: msg({ id: 'm1', type: 'text', text: { body: 'printer issue' } }), ...BASE })
    expect(result).toEqual({ ok: true, inbound: expect.objectContaining({ kind: 'text', text: 'printer issue', externalMessageId: 'm1' }) })
  })

  it('maps a recognized greeting to kind:command text:new (Step 8 entry intent mapping)', () => {
    const result = mapMetaMessageToInbound({ message: msg({ id: 'm2', type: 'text', text: { body: 'Hi' } }), ...BASE })
    expect(result).toEqual({ ok: true, inbound: expect.objectContaining({ kind: 'command', text: 'new' }) })
  })

  it('maps a literal "cancel" text message straight through — Stage 4 already recognizes it itself', () => {
    const result = mapMetaMessageToInbound({ message: msg({ id: 'm3', type: 'text', text: { body: 'cancel' } }), ...BASE })
    expect(result).toEqual({ ok: true, inbound: expect.objectContaining({ kind: 'text', text: 'cancel' }) })
  })

  it('maps a list_reply with a plain business id to kind:selection', () => {
    const result = mapMetaMessageToInbound({
      message: msg({ id: 'm4', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'sub-cat-uuid-123', title: 'Printer Issue' } } }),
      ...BASE,
    })
    expect(result).toEqual({ ok: true, inbound: expect.objectContaining({ kind: 'selection', selectionId: 'sub-cat-uuid-123' }) })
  })

  it('maps a button_reply carrying a cmd: prefixed id to kind:command, stripping the prefix', () => {
    const result = mapMetaMessageToInbound({
      message: msg({ id: 'm5', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: commandButtonId('create'), title: 'Create Ticket' } } }),
      ...BASE,
    })
    expect(result).toEqual({ ok: true, inbound: expect.objectContaining({ kind: 'command', text: 'create' }) })
  })

  it('rejects an interactive reply with neither list_reply nor button_reply populated', () => {
    const result = mapMetaMessageToInbound({ message: msg({ id: 'm6', type: 'interactive', interactive: { type: 'list_reply' } }), ...BASE })
    expect(result).toEqual({ ok: false, reason: 'empty_interactive' })
  })

  it.each(['image', 'document', 'audio', 'video'] as const)('maps a %s message to kind:file with the media reference', (mediaType) => {
    const result = mapMetaMessageToInbound({
      message: msg({ id: 'm7', type: mediaType, [mediaType]: { id: 'media-abc', mime_type: 'image/jpeg', filename: 'photo.jpg' } } as never),
      ...BASE,
    })
    expect(result).toEqual({
      ok: true,
      inbound: expect.objectContaining({ kind: 'file', attachment: { externalMediaId: 'media-abc', fileName: 'photo.jpg', mimeType: 'image/jpeg' } }),
    })
  })

  it.each(['sticker', 'reaction', 'location', 'contacts', 'unknown'])('treats an unsupported message type "%s" safely, never as text', (type) => {
    const result = mapMetaMessageToInbound({ message: msg({ id: 'm8', type }), ...BASE })
    expect(result).toEqual({ ok: false, reason: 'unsupported_type' })
  })

  it('maps a template quick-reply button payload the same way as an interactive reply', () => {
    const result = mapMetaMessageToInbound({
      message: msg({ id: 'm9', type: 'button', button: { text: 'Create Ticket', payload: commandButtonId('create') } }),
      ...BASE,
    })
    expect(result).toEqual({ ok: true, inbound: expect.objectContaining({ kind: 'command', text: 'create' }) })
  })

  it('derives receivedAt from the message timestamp, in ISO format', () => {
    const result = mapMetaMessageToInbound({ message: msg({ id: 'm10', type: 'text', text: { body: 'hi there' }, timestamp: '1700000000' } as never), ...BASE })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.inbound.receivedAt).toBe(new Date(1700000000 * 1000).toISOString())
  })
})
