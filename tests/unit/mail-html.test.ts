// VAPT-046: the e-mail viewer must not be able to fetch remote content, move the frame, or submit anything unless the reader chose to load images.
import { describe, it, expect } from 'vitest'
import { prepareMailHtml, cleanCss } from '@/lib/intake/mail-html'

const clean = (h: string) => prepareMailHtml(h) ?? ''

describe('prepareMailHtml', () => {
  it('removes everything that can fetch, redirect or submit', () => {
    const hostile = `
      <meta http-equiv="refresh" content="0;url=https://evil.example/">
      <base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/a.css">
      <script>alert(1)</script><iframe src="https://evil.example/"></iframe><object data="https://evil.example/x"></object><embed src="https://evil.example/y">
      <form action="https://evil.example/post"><input name="x"><button>go</button></form>
      <video poster="https://evil.example/p.png" src="https://evil.example/v.mp4"></video><audio src="https://evil.example/a.mp3"></audio>
      <table background="https://evil.example/bg.png"><tr><td background="https://evil.example/bg2.png">cell</td></tr></table>
      <svg onload="alert(1)"><image href="https://evil.example/i.svg"/></svg><p onclick="x()">text</p>`
    const out = clean(hostile)
    expect(out).not.toMatch(/<(meta|base|link|script|iframe|object|embed|form|input|button|video|audio|svg|image)\b/i)
    expect(out).not.toMatch(/evil\.example/)
    expect(out).not.toMatch(/onclick|onload|background=/i)
    expect(out).toContain('cell')
    expect(out).toContain('text')
  })

  it('moves a remote image address to data-remote-src, so the browser does not fetch it', () => {
    const out = clean('<img src="https://tracker.example/pixel.gif?u=1" srcset="https://tracker.example/2x.gif 2x" alt="x">')
    expect(out).toContain('data-remote-src="https://tracker.example/pixel.gif?u=1"')
    expect(out).not.toMatch(/\ssrc=|srcset/i)
  })

  it('keeps embedded images and refuses other schemes', () => {
    const out = clean('<img src="data:image/png;base64,AAAA"><img src="javascript:alert(1)"><img src="file:///C:/secret.png"><img src="ftp://x.example/a.png">')
    expect(out).toContain('src="data:image/png;base64,AAAA"')
    expect(out).not.toMatch(/javascript:|file:|ftp:/i)
  })

  it('removes url(), @import and similar from style tags and style attributes', () => {
    const out = clean(`<style>@import url(https://evil.example/a.css); .a{background:url(https://evil.example/b.png);color:red} .b{behavior:url(x.htc)}</style>
      <div style="background-image:url('https://evil.example/c.png');color:blue">x</div>`)
    expect(out).not.toMatch(/evil\.example|@import|behavior|url\s*\(/i)
    expect(out).toContain('color:red')
    expect(out).toContain('color:blue')
  })

  it('links open in a new window without leaking the opener, and javascript: links are dropped', () => {
    const out = clean('<a href="https://ok.example/p">ok</a><a href="javascript:alert(1)">bad</a>')
    expect(out).toContain('href="https://ok.example/p"')
    expect(out).toMatch(/rel="noopener noreferrer nofollow"/)
    expect(out).not.toMatch(/javascript:/i)
  })

  it('plain formatting survives and empty input stays empty', () => {
    expect(clean('<p><strong>Hello</strong> <em>team</em></p><ul><li>one</li></ul>')).toBe('<p><strong>Hello</strong> <em>team</em></p><ul><li>one</li></ul>')
    expect(prepareMailHtml(null)).toBeNull()
    expect(prepareMailHtml('   ')).toBe('   ')
  })

  it('cleanCss neutralises the dangerous forms', () => {
    expect(cleanCss('a{background:url( "https://x" )}')).toBe('a{background:none}')
    expect(cleanCss('width:expression(alert(1))')).toBe('width:none')
  })
})
