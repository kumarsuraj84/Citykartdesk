/** Stage 4, Step 10 — command parsing: case-insensitive, whitespace-tolerant,
 *  small fixed vocabulary. No DB. */
import { describe, it, expect } from 'vitest'
import { parseCommand } from '@/lib/conversations/types'

describe('parseCommand()', () => {
  it('recognizes new/NEW/ New  regardless of case/whitespace', () => {
    expect(parseCommand('new')).toBe('new')
    expect(parseCommand('NEW')).toBe('new')
    expect(parseCommand(' New ')).toBe('new')
  })
  it('recognizes cancel/CANCEL', () => {
    expect(parseCommand('cancel')).toBe('cancel')
    expect(parseCommand('CANCEL')).toBe('cancel')
  })
  it('recognizes restart/create/edit', () => {
    expect(parseCommand('restart')).toBe('restart')
    expect(parseCommand('create')).toBe('create')
    expect(parseCommand('edit')).toBe('edit')
  })
  it('returns null for ordinary text', () => {
    expect(parseCommand('printer issue')).toBeNull()
    expect(parseCommand('9876543210')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
  it('does not fuzzy-match conversational synonyms (Stage 5 renderer maps those, not Stage 4)', () => {
    expect(parseCommand('hi')).toBeNull()
    expect(parseCommand('hello')).toBeNull()
    expect(parseCommand('start')).toBeNull()
  })
})
