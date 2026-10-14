import { describe, it, expect } from 'vitest'
import { queueParams, queueTabParams } from '@/lib/requests/queue-url'

const base = { layout: 'table' as const, tab: 'team' as const }

describe('the Agent Requests page address', () => {
  it('a filter chosen on the Team Queue keeps the Team Queue (it used to fall back to My Requests)', () => {
    const p = queueParams({ ...base, priority: 'high' })
    expect(p.get('tab')).toBe('team')
    // what a filter does: take the page's choices, add its own, go to the same page
    p.set('service', 'svc-1')
    expect(new URLSearchParams(p.toString()).get('tab')).toBe('team')
  })
  it('keeps every choice of the page', () => {
    const p = queueParams({ layout: 'board', tab: 'team', status: 'open', q: 'ac', requester: 'r1', assigned: 'unassigned', breachedOnly: true, priority: 'high', service: 's', category: 'c', subcategory: 'sc', sort: 'priority', dir: 'asc' })
    expect(Object.fromEntries(p)).toEqual({ layout: 'board', tab: 'team', status: 'open', q: 'ac', requester: 'r1', assigned: 'unassigned', sla: 'breached', priority: 'high', service: 's', category: 'c', subcategory: 'sc', sort: 'priority', dir: 'asc' })
  })
  it('My Requests tab has no tab parameter and no technician choice', () => {
    const p = queueParams({ layout: 'table', tab: 'mine', assigned: 'someone', priority: 'low' })
    expect(Object.fromEntries(p)).toEqual({ priority: 'low' })
  })
  it('moving to the other tab starts it clean: the filters of one tab do not follow you to the other', () => {
    expect(Object.fromEntries(queueTabParams('mine', 'table'))).toEqual({ tab: 'mine' })
    expect(Object.fromEntries(queueTabParams('team', 'board'))).toEqual({ layout: 'board', tab: 'team' })
  })
})
