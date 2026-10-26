import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// QA-D003: a sign-in form without method="post" is sent as a plain GET when it is submitted before the page has finished loading (fast typing, a slow device, a blocked
// script), and the e-mail and the PASSWORD then travel in the web address (browser history, server logs, the Referer header). Every form of the sign-in area must say POST.
const root = path.resolve(__dirname, '..', '..', 'app', '(auth)')
const files: string[] = []
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(n)) files.push(p) } }
walk(root)

describe('the sign-in area forms never put the password in the web address', () => {
  it('finds the three forms', () => {
    const withForm = files.filter((f) => /<form\b/.test(readFileSync(f, 'utf8')))
    expect(withForm.map((f) => path.basename(path.dirname(f))).sort()).toEqual(['forgot-password', 'login', 'reset-password'])
  })
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!/<form\b/.test(src)) continue
    it(`${path.basename(path.dirname(f))}: every <form> says method="post"`, () => {
      const tags = src.match(/<form\b[^>]*>/g) ?? []
      expect(tags.length).toBeGreaterThan(0)
      for (const t of tags) expect(t, t).toMatch(/method=["']post["']/i)
    })
  }
})
