// An OEM answering a ticket that was e-mailed to it from the AC / Genset sheets. The note written for that mail is "Ticket sent to the AC OEM for servicing." with a
// "To:" line; the reply check used to look for the OEM's NAME in the note, which this note does not have, so the OEM's answer was refused ("takes no part in this ticket").
import { describe, it, expect } from 'vitest'
import { oemNoteRecipients, senderMayReply } from '@/lib/email/inbound-participant'
import { stripQuotedReply } from '@/lib/email/quote-strip'

const NOTE = [
  'Ticket sent to the AC OEM for servicing.', '',
  'Subject: New AC Issue Ticket - CKSD-000520 - SDH',
  'To: serviceka@daikinindia.com, ankur.gupta@daikinindia.com, laksh.aggarwal@daikinindia.com',
  'CC: krishan.patel@citykartstores.com', '',
  'Message sent:', 'Dear Team,',
].join('\n')

// a minimal stand-in for the data client: only request_comments, only .select().eq().ilike().limit()
function client(comments: { request_id: string; body: string }[]) {
  return {
    from: () => {
      let rows = comments
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => { rows = rows.filter((r) => r.request_id === v); return q },
        ilike: (_c: string, pattern: string) => {
          const re = new RegExp('^' + pattern.replace(/\\([\\%_])/g, '\u0001$1').replace(/[.*+?^${}()|[\]]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/\u0001(.)/g, '\\$1') + '$', 'i')
          rows = rows.filter((r) => re.test(r.body))
          return q
        },
        limit: async () => ({ data: rows }),
      }
      return q
    },
  }
}
const ticket = { id: 't1', requester_id: 'r', assigned_to: 'a', team_id: null }

describe('the addresses a "Ticket sent to the AC OEM" note went to', () => {
  it('reads the To: line only (not the CC: line)', () => {
    expect(oemNoteRecipients(NOTE)).toEqual(['serviceka@daikinindia.com', 'ankur.gupta@daikinindia.com', 'laksh.aggarwal@daikinindia.com'])
    expect(oemNoteRecipients('Hello')).toEqual([])
  })
})

describe('who may answer a ticket that was sent to an OEM from the sheets', () => {
  const admin = client([{ request_id: 't1', body: NOTE }])

  it('an address the mail went to may answer (any capitals)', async () => {
    expect(await senderMayReply(admin as never, ticket, { kind: 'oem', name: 'AC OEM (UMS CLIMATE)', email: 'ServiceKA@DaikinIndia.com' })).toBe(true)
  })
  it('a colleague at the same company may answer', async () => {
    expect(await senderMayReply(admin as never, ticket, { kind: 'oem', name: 'AC OEM (UMS CLIMATE)', email: 'someone.new@daikinindia.com' })).toBe(true)
  })
  it('another company may not, and neither may a look-alike domain', async () => {
    expect(await senderMayReply(admin as never, ticket, { kind: 'oem', name: 'AC OEM (VOLTAS)', email: 'service@voltas.test' })).toBe(false)
    expect(await senderMayReply(admin as never, ticket, { kind: 'oem', name: 'AC OEM (X)', email: 'a@daikinindia.com.evil.test' })).toBe(false)
    expect(await senderMayReply(admin as never, ticket, { kind: 'oem', name: 'AC OEM (X)', email: 'a@xdaikinindia.com' })).toBe(false)
  })
  it('it is refused on a ticket that was never sent to an OEM, and without an address', async () => {
    expect(await senderMayReply(client([]) as never, ticket, { kind: 'oem', name: 'AC OEM (UMS CLIMATE)', email: 'serviceka@daikinindia.com' })).toBe(false)
    expect(await senderMayReply(admin as never, ticket, { kind: 'oem', name: 'AC OEM (UMS CLIMATE)' })).toBe(false)
    expect(await senderMayReply(admin as never, { ...ticket, id: 't2' }, { kind: 'oem', name: 'AC OEM', email: 'serviceka@daikinindia.com' })).toBe(false)
  })
  it('a shared mail domain is never one company: a listed gmail address may answer, other gmail users may not', async () => {
    const gmail = client([{ request_id: 't1', body: 'Ticket sent to the Genset OEM for servicing.\n\nTo: dealer.one@gmail.com\n\nMessage sent:\nx' }])
    expect(await senderMayReply(gmail as never, ticket, { kind: 'oem', name: 'Genset OEM', email: 'dealer.one@gmail.com' })).toBe(true)
    expect(await senderMayReply(gmail as never, ticket, { kind: 'oem', name: 'Genset OEM', email: 'someone.else@gmail.com' })).toBe(false)
  })
  it('an older note that names the OEM still works', async () => {
    const old = client([{ request_id: 't1', body: 'Ticket sent to Acme Cooling (service@acme.test) for servicing.' }])
    expect(await senderMayReply(old as never, ticket, { kind: 'oem', name: 'Acme Cooling' })).toBe(true)
  })
})

describe('a reply with a signature under the quoted thread', () => {
  const reply = [
    'Hi Swapnil - one AC is not working at Siddhi store. Kindly arrange the team.',
    '',
    'On Wed, Oct 28, 2026 at 9:05 AM Service Key Account <',
    'serviceka@daikinindia.com> wrote:',
    '',
    '> Dear Sir/Ma\'am,',
    '> Thank you for writing to DAIKIN India Key Account Helpdesk.',
    '> *From:* CitykartDesk <citykartdesk@citykartstores.com>',
    '> Ticket No',
    '> CKSD-000520',
    '',
    '',
    '-- ',
    'Thanks & Regards',
    'Krishan',
    '7703952620.',
  ].join('\n')

  it('keeps only what the person wrote: the quoted thread and the signature go', () => {
    const out = stripQuotedReply(reply)
    expect(out).toBe('Hi Swapnil - one AC is not working at Siddhi store. Kindly arrange the team.')
  })
  it('still keeps an answer written under the quoted lines, even with a signature after it', () => {
    const inline = ['On Mon, 1 Jan 2026 at 10:00 A <a@b.test> wrote:', '> Is the store open?', 'Yes, open till 9 pm.', '> Is power on?', 'Power is on.', '-- ', 'Krishan'].join('\n')
    const out = stripQuotedReply(inline)
    expect(out).toContain('Yes, open till 9 pm.')
    expect(out).toContain('Power is on.')
  })
  it('a phone footer after the quote is not an answer either', () => {
    const phone = ['Done, thanks.', '', 'On Mon, 1 Jan 2026 at 10:00 A <a@b.test> wrote:', '> Please confirm', '', 'Sent from my iPhone'].join('\n')
    expect(stripQuotedReply(phone)).toBe('Done, thanks.')
  })
})
