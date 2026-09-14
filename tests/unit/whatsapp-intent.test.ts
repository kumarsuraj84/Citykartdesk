import { describe, it, expect } from 'vitest'
import { mapFriendlyGreetingToNew } from '@/lib/whatsapp/intent'

describe('Stage 5 — friendly greeting -> NEW intent mapping', () => {
  it.each(['Hi', 'hi', ' Hi ', 'HELLO', 'hey', 'New', 'Ticket', 'Create Ticket', 'raise ticket', 'RAISE   TICKET'])(
    'maps %j to "new"',
    (text) => {
      expect(mapFriendlyGreetingToNew(text)).toBe('new')
    }
  )

  it('does NOT map "help" — the brief lists it as something users may type but excludes it from the recommended mapping', () => {
    expect(mapFriendlyGreetingToNew('help')).toBeNull()
    expect(mapFriendlyGreetingToNew('Help')).toBeNull()
  })

  it('does not substring-match — a real answer that merely contains a trigger word is left alone', () => {
    expect(mapFriendlyGreetingToNew('I need a new printer cartridge')).toBeNull()
    expect(mapFriendlyGreetingToNew('please raise ticket priority to urgent')).toBeNull()
  })

  it('returns null for ordinary free text (e.g. an issue description)', () => {
    expect(mapFriendlyGreetingToNew('The printer at billing counter 2 is jammed')).toBeNull()
  })

  it('returns null for the empty string', () => {
    expect(mapFriendlyGreetingToNew('')).toBeNull()
  })
})
