import 'server-only'
import { getCurrentProfile } from '@/lib/queries/profiles'
import type { ProfileWithTeams } from '@/types'
import { inPilot, readCkoneaiConfig, type CkoneaiConfig } from './config'
import { mayUseAssistant } from './roles'

// Who may use the assistant. One answer for the menu, the chat page and the forwarding routes, so they can never disagree.
//   not switched on / not set up   -> 503  (nothing is forwarded; the reason goes to the log only)
//   no session, no profile, an inactive person, or a pending password change -> 401   (getCurrentProfile already returns null for all of these)
//   a vendor (OEM engineer) login, or a person not on the pilot list           -> 403

export type Access =
  | { ok: true; cfg: Extract<CkoneaiConfig, { on: true }>; profile: ProfileWithTeams }
  | { ok: false; status: 401 | 403 | 503; error: string; reason?: string }

/** The decision once the profile is known (pure; the menu uses it too). */
export function decideAccess(cfg: CkoneaiConfig, profile: ProfileWithTeams | null): Access {
  if (!cfg.on) return { ok: false, status: 503, error: 'The assistant is switched off.', reason: cfg.reason }
  if (!profile) return { ok: false, status: 401, error: 'Sign in to use the assistant.' }
  if (!mayUseAssistant(profile)) return { ok: false, status: 403, error: 'The assistant is not available for this login.' }
  if (!inPilot(cfg, profile.id)) return { ok: false, status: 403, error: 'The assistant is not open to you yet.' }
  return { ok: true, cfg, profile }
}

export async function assistantAccess(): Promise<Access> {
  const cfg = readCkoneaiConfig()
  if (!cfg.on) return decideAccess(cfg, null)
  return decideAccess(cfg, await getCurrentProfile())
}
