import { describe, it, expect } from 'vitest'
import { isAcceptablePushEndpoint } from '@/lib/push/endpoint'

describe('isAcceptablePushEndpoint (audit D-025)', () => {
  it('accepts the endpoints real browsers use', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/QGxxx',
    ]) expect(isAcceptablePushEndpoint(e), e).toBe(true)
  })
  it('refuses internal, loopback, address-literal and non-https targets', () => {
    for (const e of [
      'http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.205/x', 'https://[::1]/x', 'https://2130706433/x',
      'https://intranet/x', 'https://db.internal/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'ftp://fcm.googleapis.com/x',
      'not a url', '', 'https://192.168.1.10/x', 'https://printer.local/x',
    ]) expect(isAcceptablePushEndpoint(e), e).toBe(false)
  })
  it('refuses non-strings and oversized values', () => {
    expect(isAcceptablePushEndpoint(undefined)).toBe(false)
    expect(isAcceptablePushEndpoint(42)).toBe(false)
    expect(isAcceptablePushEndpoint('https://fcm.googleapis.com/' + 'a'.repeat(3000))).toBe(false)
  })
})
