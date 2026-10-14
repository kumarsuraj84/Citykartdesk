import { describe, it, expect } from 'vitest'
import { mailHostProblem } from '@/lib/validation/mail-host'

describe('mail server address check (D-026)', () => {
  it('accepts ordinary mail servers, including internal relays on private addresses', () => {
    for (const h of ['smtp.gmail.com', 'smtp-relay.gmail.com', 'mail.citykart.org', 'SMTP.Office365.com', '10.0.0.25', '192.168.1.10', '172.16.4.2', 'mail-relay', 'smtp.gmail.com.'])
      expect(mailHostProblem(h), h).toBeNull()
  })
  it('refuses this computer, "this host", link-local and metadata addresses', () => {
    for (const h of ['localhost', 'LOCALHOST', 'localhost.localdomain', 'mail.localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '0.1.2.3', '169.254.169.254', '169.254.0.1', 'metadata.google.internal', 'metadata', 'instance-data'])
      expect(mailHostProblem(h), h).toMatch(/\S/)
  })
  it('refuses numeric shortcuts for an address, impossible octets and multicast', () => {
    for (const h of ['2130706433', '0x7f000001', '999.1.1.1', '224.0.0.1', '255.255.255.255']) expect(mailHostProblem(h), h).toMatch(/\S/)
  })
  it('refuses empty, over-long and oddly written names', () => {
    for (const h of ['', ' ', 'a'.repeat(254), 'smtp gmail.com', 'smtp.gmail.com/path', 'http://smtp.gmail.com', 'smtp.gmail.com:587', '[::1]', 'user@smtp.gmail.com']) expect(mailHostProblem(h), h).toMatch(/\S/)
  })
})
