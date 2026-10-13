// D-052: an inbound e-mail attachment's storage key is generated; the sender's file name never becomes part of the path.

import { describe, it, expect } from 'vitest'
import { attachmentStorageKey } from '../../api/src/intake/storage-key'
import { isSafeIntakeStoragePath } from '@/lib/attachments/intake-key'

const ORG = '00000000-0000-0000-0000-000000000001'
const MSG = '3f2b8c1e-5d4a-4b7e-9c1a-0e6f2d8a7b31'
const KEY = new RegExp(`^${ORG}/${MSG}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\\.[a-z0-9]{1,8})?$`)

describe('attachmentStorageKey', () => {
  it('is org/message/random-uuid with a short safe extension', () => {
    expect(attachmentStorageKey(ORG, MSG, 'Quote.PDF')).toMatch(KEY)
    expect(attachmentStorageKey(ORG, MSG, 'Quote.PDF').endsWith('.pdf')).toBe(true)
  })
  it('hostile file names (path traversal, separators, long or odd extensions) never reach the key', () => {
    for (const name of ['../../x.png', '..\\..\\x.png', 'a/b/c.png', '%2e%2e%2fx.png', 'x.p/ng', 'x.' + 'a'.repeat(30), '', 'noext', '.hidden', 'x.html?x=1', 'x.png\u0000.html']) {
      const k = attachmentStorageKey(ORG, MSG, name)
      expect(k, name).toMatch(KEY)
      expect(k.split('/')).toHaveLength(3)
    }
  })
  it('two attachments with the same name get different keys (no more silent overwrite)', () => {
    expect(attachmentStorageKey(ORG, MSG, 'image.png')).not.toBe(attachmentStorageKey(ORG, MSG, 'image.png'))
  })
})

describe('isSafeIntakeStoragePath (the download route)', () => {
  it('follows the generated shape and the older shape that kept the sender file name', () => {
    expect(isSafeIntakeStoragePath(attachmentStorageKey(ORG, MSG, 'a.pdf'))).toBe(true)
    expect(isSafeIntakeStoragePath(`${ORG}/${MSG}/Quote 2026 (final).pdf`)).toBe(true)
  })
  it('refuses traversal-shaped or malformed paths', () => {
    for (const p of [`${ORG}/${MSG}/../../x`, `${ORG}/${MSG}`, `${ORG}/${MSG}/a/b`, `../${MSG}/x`, `${ORG}//x`, `${ORG}/${MSG}/%2e%2e`, `${ORG}/${MSG}/a?b`, '', null, undefined, 5]) {
      expect(isSafeIntakeStoragePath(p), String(p)).toBe(false)
    }
  })
})
