/** Stage 4, Step 31 — pure state-machine transition validation. No DB. */
import { describe, it, expect } from 'vitest'
import { canTransition, transitionConversation } from '@/lib/conversations/state-machine'
import { ACTIVE_CONVERSATION_STATES, TERMINAL_CONVERSATION_STATES, isActiveState } from '@/lib/conversations/types'
import type { ConversationState } from '@/lib/conversations/types'

describe('canTransition() — legal forward path', () => {
  it('identified -> awaiting_service', () => {
    expect(canTransition('identified', 'awaiting_service')).toBe(true)
  })
  it('awaiting_service -> awaiting_issue_search', () => {
    expect(canTransition('awaiting_service', 'awaiting_issue_search')).toBe(true)
  })
  it('awaiting_issue_search -> awaiting_subcategory (search with results)', () => {
    expect(canTransition('awaiting_issue_search', 'awaiting_subcategory')).toBe(true)
  })
  it('awaiting_issue_search -> awaiting_issue_search (no results, stay put)', () => {
    expect(canTransition('awaiting_issue_search', 'awaiting_issue_search')).toBe(true)
  })
  it('awaiting_subcategory -> awaiting_description', () => {
    expect(canTransition('awaiting_subcategory', 'awaiting_description')).toBe(true)
  })
  it('awaiting_description -> collecting_fields / awaiting_file / review', () => {
    expect(canTransition('awaiting_description', 'collecting_fields')).toBe(true)
    expect(canTransition('awaiting_description', 'awaiting_file')).toBe(true)
    expect(canTransition('awaiting_description', 'review')).toBe(true)
  })
  it('collecting_fields -> collecting_fields (next field)', () => {
    expect(canTransition('collecting_fields', 'collecting_fields')).toBe(true)
  })
  it('collecting_fields -> awaiting_file (required file next)', () => {
    expect(canTransition('collecting_fields', 'awaiting_file')).toBe(true)
  })
  it('collecting_fields -> review (all required complete)', () => {
    expect(canTransition('collecting_fields', 'review')).toBe(true)
  })
  it('review -> submitting -> completed', () => {
    expect(canTransition('review', 'submitting')).toBe(true)
    expect(canTransition('submitting', 'completed')).toBe(true)
  })
  it('submitting -> review (creation failure)', () => {
    expect(canTransition('submitting', 'review')).toBe(true)
  })
})

describe('canTransition() — cancel / expiry', () => {
  it('cancel is legal from every active state', () => {
    for (const state of ACTIVE_CONVERSATION_STATES) {
      if (state === 'submitting') continue // submitting is the one deliberate exception
      expect(canTransition(state, 'cancelled')).toBe(true)
    }
  })
  it('expiry is legal from every active state', () => {
    for (const state of ACTIVE_CONVERSATION_STATES) {
      if (state === 'submitting') continue
      expect(canTransition(state, 'expired')).toBe(true)
    }
  })
  it('submitting cannot be cancelled or expired', () => {
    expect(canTransition('submitting', 'cancelled')).toBe(false)
    expect(canTransition('submitting', 'expired')).toBe(false)
  })
})

describe('canTransition() — config-drift backward transitions (Step 25)', () => {
  it('collecting_fields -> awaiting_service / awaiting_subcategory (service/sub-category drift)', () => {
    expect(canTransition('collecting_fields', 'awaiting_service')).toBe(true)
    expect(canTransition('collecting_fields', 'awaiting_subcategory')).toBe(true)
  })
  it('review -> collecting_fields / awaiting_file (a new mandatory field appeared)', () => {
    expect(canTransition('review', 'collecting_fields')).toBe(true)
    expect(canTransition('review', 'awaiting_file')).toBe(true)
  })
  it('review -> awaiting_service / awaiting_subcategory (service/sub-category invalidated before CREATE)', () => {
    expect(canTransition('review', 'awaiting_service')).toBe(true)
    expect(canTransition('review', 'awaiting_subcategory')).toBe(true)
  })
})

describe('canTransition() — illegal transitions', () => {
  it('cannot skip ahead: awaiting_service -> review', () => {
    expect(canTransition('awaiting_service', 'review')).toBe(false)
  })
  it('cannot skip ahead: identified -> collecting_fields', () => {
    expect(canTransition('identified', 'collecting_fields')).toBe(false)
  })
  it('cannot skip ahead: awaiting_service -> completed', () => {
    expect(canTransition('awaiting_service', 'completed')).toBe(false)
  })
  it('cannot move out of any terminal state', () => {
    for (const state of TERMINAL_CONVERSATION_STATES) {
      expect(canTransition(state, 'awaiting_service')).toBe(false)
      expect(canTransition(state, 'review')).toBe(false)
    }
  })
  it('cannot go backward past where config drift would ever send it: awaiting_service -> awaiting_description', () => {
    expect(canTransition('awaiting_service', 'awaiting_description')).toBe(false)
  })
})

describe('canTransition() — self-loop re-prompt (Stage 7 UAT Findings F-29/F-30)', () => {
  it('every active, non-submitting state may re-prompt itself (errorStayingPut()\'s requirement)', () => {
    for (const state of ACTIVE_CONVERSATION_STATES) {
      if (state === 'submitting') continue
      expect(canTransition(state, state)).toBe(true)
    }
  })
  it('submitting may not re-prompt itself (a submission in flight is not re-enterable)', () => {
    expect(canTransition('submitting', 'submitting')).toBe(false)
  })
  it('no terminal state may re-prompt itself', () => {
    for (const state of TERMINAL_CONVERSATION_STATES) {
      expect(canTransition(state, state)).toBe(false)
    }
  })
  it('F-30: awaiting_description -> awaiting_service is now legal (config-drift bounce from sendBackToServiceSelection())', () => {
    expect(canTransition('awaiting_description', 'awaiting_service')).toBe(true)
  })
})

describe('transitionConversation()', () => {
  it('returns the target state for a legal transition', () => {
    expect(transitionConversation('awaiting_service', 'awaiting_issue_search')).toBe('awaiting_issue_search')
  })
  it('throws for an illegal transition', () => {
    expect(() => transitionConversation('awaiting_service', 'completed')).toThrow(/Illegal conversation state transition/)
  })
})

describe('isActiveState() / ACTIVE_CONVERSATION_STATES / TERMINAL_CONVERSATION_STATES', () => {
  it('every active state is not terminal and vice versa', () => {
    const all: ConversationState[] = [...ACTIVE_CONVERSATION_STATES, ...TERMINAL_CONVERSATION_STATES]
    expect(new Set(all).size).toBe(all.length) // no overlap
  })
  it('isActiveState() matches ACTIVE_CONVERSATION_STATES exactly', () => {
    for (const state of ACTIVE_CONVERSATION_STATES) expect(isActiveState(state)).toBe(true)
    for (const state of TERMINAL_CONVERSATION_STATES) expect(isActiveState(state)).toBe(false)
  })
})
