import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/lib/auth/safe-next'

describe('safeNextPath (audit D-034)', () => {
  it('keeps ordinary in-site paths, with query and hash', () => {
    for (const p of ['/home', '/requests/abc?tab=1', '/reset-password#access_token=x', '/']) expect(safeNextPath(p)).toBe(p)
  })
  it('uses the default for a missing or empty value', () => {
    expect(safeNextPath(null)).toBe('/home')
    expect(safeNextPath(undefined)).toBe('/home')
    expect(safeNextPath('')).toBe('/home')
    expect(safeNextPath('', '/reset-password')).toBe('/reset-password')
  })
  it('refuses anything that could leave the site', () => {
    for (const p of ['https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example', '@evil.example', '.evil.example', 'evil.example', 'javascript:alert(1)', '/a\r\nb', '/a\tb']) {
      expect(safeNextPath(p), p).toBe('/home')
    }
  })
  it('refuses an oversized value', () => {
    expect(safeNextPath('/' + 'a'.repeat(3000))).toBe('/home')
  })
})
