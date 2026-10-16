import { describe, it, expect } from 'vitest'
import { generateOneTimePassword } from '@/lib/auth/one-time-password'

describe('one-time passwords (VAPT-003: no shared default password)', () => {
  it('are long enough and mix upper case, lower case, digits and symbols', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateOneTimePassword()
      expect(p.length).toBeGreaterThanOrEqual(14)
      expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[0-9]/); expect(p).toMatch(/[!@#$%&*?]/)
      expect(p).not.toMatch(/[0O1lI]/)                                    // nothing that is easy to misread
    }
  })
  it('are different every time (no repeats in 5,000 draws) and never the old shared default', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generateOneTimePassword()))
    expect(seen.size).toBe(5000)
    expect([...seen].some((p) => p.toLowerCase().startsWith('welcome'))).toBe(false)
  })
  it('a requested length below 12 is raised to 12', () => {
    expect(generateOneTimePassword(4).length).toBe(12)
  })
})
