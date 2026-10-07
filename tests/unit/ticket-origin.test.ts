import { describe, it, expect } from 'vitest'
import { safeOrigin, defaultTicketOrigin, navActivePath, ticketHref } from '@/lib/requests/origin'

describe('safeOrigin', () => {
  it('accepts internal paths and rejects anything else', () => {
    expect(safeOrigin('/requests/queue?tab=team')).toBe('/requests/queue?tab=team')
    expect(safeOrigin('//evil.example/x')).toBeNull()
    expect(safeOrigin('https://evil.example')).toBeNull()
    expect(safeOrigin('')).toBeNull()
    expect(safeOrigin(undefined)).toBeNull()
  })
})

describe('defaultTicketOrigin — which list a ticket belongs to when the link did not say', () => {
  const me = 'u-me'
  it('a ticket I raised belongs to Requests', () => {
    expect(defaultTicketOrigin({ viewerId: me, requesterId: me, assignedTo: 'someone-else', viewerCanWork: true })).toBe('/requests')
    expect(defaultTicketOrigin({ viewerId: me, requesterId: me, assignedTo: null, viewerCanWork: false })).toBe('/requests')
  })
  it('a ticket assigned to me belongs to Agent Requests', () => {
    expect(defaultTicketOrigin({ viewerId: me, requesterId: 'u-req', assignedTo: me, viewerCanWork: true })).toBe('/requests/queue')
  })
  it('a ticket in my group that someone else raised belongs to Agent Requests', () => {
    expect(defaultTicketOrigin({ viewerId: me, requesterId: 'u-req', assignedTo: null, viewerCanWork: true })).toBe('/requests/queue')
  })
  it('a ticket I raised AND am assigned to counts as work', () => {
    expect(defaultTicketOrigin({ viewerId: me, requesterId: me, assignedTo: me, viewerCanWork: true })).toBe('/requests/queue')
  })
  it('a plain requester viewing someone else’s ticket (collaborator) stays on Requests', () => {
    expect(defaultTicketOrigin({ viewerId: me, requesterId: 'u-req', assignedTo: 'u-tech', viewerCanWork: false })).toBe('/requests')
  })
})

describe('navActivePath — what the sidebar treats as the current page', () => {
  it('a ticket opened from Agent Requests lights up Agent Requests', () => {
    expect(navActivePath('/requests/abc-123', '/requests/queue')).toBe('/requests/queue')
    expect(navActivePath('/requests/abc-123', '/requests/queue?tab=team&status=open')).toBe('/requests/queue')
  })
  it('a ticket opened from Requests (or with no origin) stays under Requests', () => {
    expect(navActivePath('/requests/abc-123', '/requests')).toBe('/requests/abc-123')
    expect(navActivePath('/requests/abc-123', null)).toBe('/requests/abc-123')
    expect(navActivePath('/requests/abc-123', '/requests?status=resolved')).toBe('/requests/abc-123')
  })
  it('only ticket pages are remapped — the lists themselves and other pages are untouched', () => {
    expect(navActivePath('/requests/queue', '/requests/queue')).toBe('/requests/queue')
    expect(navActivePath('/requests', '/requests/queue')).toBe('/requests')
    expect(navActivePath('/home', '/requests/queue')).toBe('/home')
    expect(navActivePath('/approvals', '/requests/queue')).toBe('/approvals')
  })
  it('ignores an unsafe origin', () => {
    expect(navActivePath('/requests/abc-123', '//evil.example/requests/queue')).toBe('/requests/abc-123')
  })
})

describe('ticketHref', () => {
  it('remembers where the ticket was opened from', () => {
    expect(ticketHref('abc', '/requests/queue')).toBe('/requests/abc?from=%2Frequests%2Fqueue')
  })
})
