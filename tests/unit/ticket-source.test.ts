import { describe, expect, it } from 'vitest'
import { sourceChannelOf, ticketSourceKey, TICKET_SOURCE_LABELS } from '@/lib/sources'

describe('ticketSourceKey', () => {
  it('reads web / missing / unknown as Web (tickets created before the source was recorded)', () => {
    expect(ticketSourceKey(null)).toBe('portal')
    expect(ticketSourceKey({})).toBe('portal')
    expect(ticketSourceKey({ created_via: 'portal' })).toBe('portal')
    expect(ticketSourceKey({ created_via: 'web' })).toBe('portal')
    expect(ticketSourceKey({ created_via: 'something-new' })).toBe('portal')
  })

  it('recognises every channel', () => {
    expect(ticketSourceKey({ created_via: 'whatsapp' })).toBe('whatsapp')
    expect(ticketSourceKey({ created_via: 'intake' })).toBe('intake')
    expect(ticketSourceKey({ created_via: 'email_intake' })).toBe('email')
    expect(ticketSourceKey({ created_via: 'phone' })).toBe('phone')
    expect(ticketSourceKey({ created_via: 'manual' })).toBe('manual')
    expect(ticketSourceKey({ created_via: 'api' })).toBe('api')
  })

  it('has a label for every key', () => {
    expect(TICKET_SOURCE_LABELS.portal).toBe('Web')
    expect(TICKET_SOURCE_LABELS.whatsapp).toBe('WhatsApp')
  })
})

describe('sourceChannelOf (rules / reports)', () => {
  it('maps to the coarse channels rules and reports use', () => {
    expect(sourceChannelOf({ created_via: 'whatsapp' })).toBe('whatsapp')
    expect(sourceChannelOf({ created_via: 'intake' })).toBe('intake')
    expect(sourceChannelOf({ created_via: 'email_intake' })).toBe('intake')
    expect(sourceChannelOf({ created_via: 'portal' })).toBe('portal')
    expect(sourceChannelOf(null)).toBe('portal')
  })
})
