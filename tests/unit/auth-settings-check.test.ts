import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { evaluateAuthSettings } from '@/lib/auth/settings-check'

describe('login-service settings check (VAPT-023)', () => {
  it('fails when self sign-up is on, passes when it is off', () => {
    expect(evaluateAuthSettings({ disable_signup: false }).find((f) => f.id === 'signup-disabled')?.ok).toBe(false)
    expect(evaluateAuthSettings({}).find((f) => f.id === 'signup-disabled')?.ok).toBe(false)             // not stated = not proven off
    expect(evaluateAuthSettings({ disable_signup: true }).every((f) => f.ok)).toBe(true)
  })
  it('flags social sign-in providers but ignores e-mail and phone', () => {
    expect(evaluateAuthSettings({ disable_signup: true, external: { email: true, phone: false, google: true } }).find((f) => f.id === 'no-social-login')?.ok).toBe(false)
    expect(evaluateAuthSettings({ disable_signup: true, external: { email: true, google: false } }).every((f) => f.ok)).toBe(true)
  })
})

describe('deployment templates ship with the safe settings', () => {
  it('the production template disables sign-up and sets a minimum password length of 8', () => {
    const env = readFileSync('deploy/windows/config/auth.env.example', 'utf8')
    expect(env).toMatch(/GOTRUE_DISABLE_SIGNUP="true"/)
    expect(env).toMatch(/GOTRUE_PASSWORD_MIN_LENGTH="8"/)
  })
  it('the development template disables sign-up and asks for 8+ characters with mixed characters', () => {
    const toml = readFileSync('supabase/config.toml', 'utf8')
    expect((toml.match(/enable_signup = true/g) ?? []).length).toBe(0)
    expect(toml).toMatch(/minimum_password_length = 8/)
    expect(toml).toMatch(/password_requirements = "lower_upper_letters_digits"/)
  })
})
