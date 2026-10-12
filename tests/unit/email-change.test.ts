import { describe, it, expect } from 'vitest'
import { isUsableEmail, describeEmailUpdates } from '@/lib/users/email-change'

describe('the new e-mail address', () => {
  it('accepts ordinary store, staff and plus-style addresses', () => {
    for (const ok of ['sm.neg@citykartstores.com', 'krishan.patel@citykartstores.com', 'a_b-c+tag@sub.example.co.in', "o'brien@example.com", 'x@y.io', 'SM.NEG@CITYKARTSTORES.COM']) expect(isUsableEmail(ok), ok).toBe(true)
  })

  it('refuses what is not an address, or has characters that could break a template or a rule', () => {
    for (const bad of ['', 'neg', 'neg@', '@x.com', 'neg@x', 'neg@x..com', 'neg @x.com', 'a b@x.com', 'a@b@x.com', 'a"b@x.com', 'a\\b@x.com', 'a<b>@x.com', 'a@-x.com', 'a@x-.com', 'a@x.c']) {
      expect(isUsableEmail(bad), JSON.stringify(bad)).toBe(false)
    }
    expect(isUsableEmail(`${'a'.repeat(250)}@x.com`)).toBe(false)
  })
})

describe('telling the admin what else was updated', () => {
  it('lists only the places that changed, with the right singular and plural', () => {
    expect(describeEmailUpdates({ oems: 2, teams: 0, business_rules: 1, desktime_time_logs: 40 })).toBe('2 OEM contact lists or templates, 40 DeskTime time logs, 1 business rule')
    expect(describeEmailUpdates({ intake_threads: 1, request_comments: 3 })).toBe('1 e-mail conversation, 3 e-mailed replies on tickets')
  })

  it('says nothing when the old address was not used anywhere else', () => {
    expect(describeEmailUpdates({ oems: 0, teams: 0 })).toBe('')
    expect(describeEmailUpdates({})).toBe('')
    expect(describeEmailUpdates(null)).toBe('')
    expect(describeEmailUpdates(undefined)).toBe('')
  })
})
