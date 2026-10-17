// The mail domain(s) that count as "the organisation's own" (VAPT-052 / VAPT-053): the domain of the company mailbox that sends the system's mail,
// plus any listed in ORG_MAIL_DOMAINS (comma list). When neither is known the list is empty and the caller must NOT refuse anything on this basis
// (nothing is known to compare with).
import { loadDbSmtpConfig } from '@/lib/email/mailbox'

export function parseDomainList(raw: string | undefined | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
}

export async function organisationMailDomains(): Promise<string[]> {
  const out = new Set(parseDomainList(process.env.ORG_MAIL_DOMAINS))
  try {
    const user = (await loadDbSmtpConfig())?.user
    const d = user?.includes('@') ? user.split('@')[1].toLowerCase() : null
    if (d) out.add(d)
  } catch { /* no mailbox configured yet */ }
  return [...out]
}

/** True when the address ends with one of the organisation's own domains. */
export function isOrganisationAddress(email: string, domains: string[]): boolean {
  const at = email.trim().toLowerCase().lastIndexOf('@')
  if (at < 1) return false
  const host = email.trim().toLowerCase().slice(at + 1)
  return domains.some((d) => host === d)
}
