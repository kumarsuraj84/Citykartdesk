// The password rules for a NEW password (audit A-09): at least 10 characters and at least 3 of the 4 kinds (lower case, upper case, digit, symbol).
// One function, used by every action that sets a new password (own change, reset link, administrator reset, bulk import), so the rule cannot drift.
// It is applied ONLY when a password is being set: a person with an older, weaker password can still sign in with it (sign-in never calls this) and is
// then asked for a stronger one when they change it. The sign-in service itself can enforce the same rule with GOTRUE_PASSWORD_REQUIRED_CHARACTERS
// (see deploy/windows/config/auth.env.example); this is the application's own check so the person gets a clear message.

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
export const PASSWORD_RULE_TEXT = `Use at least ${PASSWORD_MIN_LENGTH} characters, mixing at least 3 of: small letters, capital letters, digits and symbols.`

export function passwordClasses(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length
}

/** null when the password is acceptable as a NEW password; otherwise a plain sentence saying what is missing. */
export function validateNewPassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length === 0) return 'Enter a password.'
  if (pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters. ${PASSWORD_RULE_TEXT}`
  if (pw.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`
  if (passwordClasses(pw) < 3) return `Password is too simple. ${PASSWORD_RULE_TEXT}`
  return null
}
