import { describe, it, expect } from 'vitest'
import { checkResolutionNote, looksLikePassword, MIN_RESOLUTION_NOTE_CHARS, NOTE_TOO_SHORT_MESSAGE, PASSWORD_IN_NOTE_MESSAGE, NOTE_REQUIRED_MESSAGE } from '@/lib/requests/resolution-note'

describe('the note written when a ticket is resolved', () => {
  it('nothing written is refused as before', () => {
    expect(checkResolutionNote('')).toBe(NOTE_REQUIRED_MESSAGE)
    expect(checkResolutionNote('   ')).toBe(NOTE_REQUIRED_MESSAGE)
    expect(checkResolutionNote(undefined)).toBe(NOTE_REQUIRED_MESSAGE)
  })

  it('a note that says nothing about the fix is asked for more (the kind of notes that are on tickets today)', () => {
    for (const note of ['Resolved', 'Done.', 'done sir', 'Ok', 'We are resolving the ticket.', 'issue solved', 'work completed', 'All OK now', 'Pending', 'Cancelled']) {
      expect(checkResolutionNote(note), note).toBe(NOTE_TOO_SHORT_MESSAGE)
    }
  })

  it(`a note of at least ${MIN_RESOLUTION_NOTE_CHARS} characters that says what was done is accepted`, () => {
    for (const note of [
      'Cable was damaged. Replaced the cable and tested the payment.',
      'Now the issue has been resolved after opening the path.',
      'Approved 700/- for MCB purchase at the store, please do the work and share the photos.',
      'Bill cancelled in the system after the store confirmed the wrong entry.',
      'You have been granted access to LinkedIn and Instagram; please check.',
      'Bill is cancelled',
      'Cable replaced',
    ]) expect(checkResolutionNote(note), note).toBeNull()
  })

  it('exactly the shortest length is accepted, one less is not', () => {
    expect(checkResolutionNote('a'.repeat(MIN_RESOLUTION_NOTE_CHARS))).toBeNull()
    expect(checkResolutionNote('a'.repeat(MIN_RESOLUTION_NOTE_CHARS - 1))).toBe(NOTE_TOO_SHORT_MESSAGE)
  })

  describe('passwords are never accepted in the note', () => {
    it.each([
      'ID created. Pass: Xyzw@9876 for all the IDs.',
      'Password is Welcome#2026 please change it after login',
      'password = Xyzw9876abc, resolved the ticket',
      'Reset done, pwd: Qwerty12345',
      'New id created with Xyzw@9876 as the first login',
    ])('%s', (note) => {
      expect(looksLikePassword(note)).toBe(true)
      expect(checkResolutionNote(note)).toBe(PASSWORD_IN_NOTE_MESSAGE)
    })

    it('but talking about a password is fine', () => {
      for (const note of [
        'Password reset done and shared with the requester on the phone.',
        'Requester forgot the password, reset the account and asked them to change it at first login.',
        'Mail sent to store@citykart.org with the new login instructions, please check.',
        'Unlocked the account after three wrong password attempts and verified the login works.',
      ]) {
        expect(looksLikePassword(note), note).toBe(false)
        expect(checkResolutionNote(note), note).toBeNull()
      }
    })
  })
})
