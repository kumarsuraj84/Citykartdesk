import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

// The deploy swap script (scripts/windows/swap-app.ps1) run against a fake app server on this PC (tests/unit/fixtures/swap-app-harness.ps1): a real zip, real folder renames,
// a tiny node server standing in for the service. Windows only (it uses PowerShell and the real script).
const harness = path.join(__dirname, 'fixtures', 'swap-app-harness.ps1')
const script = path.join(__dirname, '..', '..', 'scripts', 'windows', 'swap-app.ps1')

function run(build: 'good' | 'bad') {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, '-NewBuild', build, '-Port', build === 'good' ? '3291' : '3292'], { encoding: 'utf8', timeout: 120_000 })
  const out = `${r.stdout ?? ''}`
  const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT')) ?? ''
  return { out, line, get: (k: string) => new RegExp(`${k}=(\\S*)`).exec(line)?.[1] ?? '' }
}

describe.skipIf(process.platform !== 'win32')('deploy swap script: short downtime and safe rollback', () => {
  it('unpacks BEFORE stopping the app, swaps the folders, keeps the settings file and the old build as a backup', () => {
    const r = run('good')
    expect(r.out).toContain('the app was still running')       // the slow unpack happened while the old build served people
    expect(r.out).toContain('HEALTHY')
    expect(r.out).toContain('the app was out of service for about')
    expect(r.line).toContain('"buildId":"NEW"')                  // the new build answers
    expect(r.get('backups')).toMatch(/^standalone-bak-\d{8}-\d{4}$/)
    expect(r.get('leftoverNext')).toBe('False')
    expect(r.get('envKept')).toBe('True')                        // .env.local was carried over
    expect(Number(r.get('longestSilenceSeconds'))).toBeLessThan(5)
  }, 130_000)

  it('a new build that never becomes healthy is rolled back to the old one', () => {
    const r = run('bad')
    expect(r.out).toContain('ROLLED BACK')
    expect(r.get('exit')).toBe('1')
    expect(r.line).toContain('"buildId":"OLD"')                  // the old build is serving again
    expect(r.get('leftoverNext')).toBe('False')
    expect(r.get('envKept')).toBe('True')
  }, 130_000)

  it('the script never unpacks over the running folder and keeps the old rules: zip must exist, build must contain server.js', () => {
    const text = fs.readFileSync(script, 'utf8')
    expect(text).toMatch(/if \(-not \(Test-Path \$zip\)\) \{ throw/)
    expect(text).toContain('has no server.js')
    expect(text.indexOf('Expand-Archive')).toBeGreaterThan(-1)
    expect(text.indexOf('Expand-Archive')).toBeLessThan(text.indexOf('Stop-Service $ServiceName -Force'))   // unpack first, stop second
  })
})
