// Checks the PUBLIC settings of a login service (GoTrue's /auth/v1/settings endpoint, which needs only the public key) against what Citykart Desk requires.
// Pure function: used by scripts/check-auth-settings.mjs (run by the owner against the live service) and by the tests. VAPT-023 / VAPT-002.

export type AuthSettings = {
  disable_signup?: boolean
  mailer_autoconfirm?: boolean
  external?: Record<string, boolean>
}

export type AuthSettingsFinding = { id: string; ok: boolean; what: string; why: string }

export function evaluateAuthSettings(settings: AuthSettings): AuthSettingsFinding[] {
  const external = Object.entries(settings.external ?? {}).filter(([k, v]) => v && k !== 'email' && k !== 'phone').map(([k]) => k)
  return [
    {
      id: 'signup-disabled', ok: settings.disable_signup === true,
      what: settings.disable_signup === true ? 'Self sign-up is switched off.' : 'Self sign-up is ON: anyone holding the public key can create an account.',
      why: 'Accounts are created by administrators. With sign-up on, a stranger would become an employee of the first organisation and could read the staff list.',
    },
    {
      id: 'no-social-login', ok: external.length === 0,
      what: external.length === 0 ? 'No social/OAuth sign-in providers are enabled.' : `Sign-in providers enabled: ${external.join(', ')}.`,
      why: 'Citykart Desk uses e-mail and password only; any other provider is an extra way in that has not been reviewed.',
    },
  ]
}
