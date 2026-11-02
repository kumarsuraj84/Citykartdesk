import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isVendor, type VendorProfileLike } from '@/lib/vendor/access'
import type { BridgeRole } from './sign'

// The ONE place that decides which roles CKOneAI is told a person has. CKOneAI never works this out itself, and nothing is remembered between
// calls: it is recomputed for every request, so a removed approver or technician loses the role at once.
//   requester   everyone who may use the assistant (everybody can raise tickets)
//   technician  agent, manager, admin or platform owner (the roles that can pick up and work tickets in CK Desk)
//   approver    manager, admin or platform owner (an "any manager" step reaches them) or anyone named on an approval step

export type RoleProfile = VendorProfileLike & { id: string; role: string }

const AGENT_TIER = new Set(['agent', 'manager', 'admin', 'platform_owner'])
const MANAGER_TIER = new Set(['manager', 'admin', 'platform_owner'])

/** The two extra signed roles (owner 2 Nov 2026). CKOneAI's verifier accepts them since commit c62c664 (v3-ckdesk), so rolesFor now sends them.
 *  'manager'  = limited to their own hierarchy (their teams and direct reports): the role manager.
 *  'orgwide'  = may see the whole organisation: admin and platform_owner now, and the COO / CEO / Director roles when they are created. */
export const isHierarchyManager = (profile: RoleProfile): boolean => profile.role === 'manager'
export const isOrgWide = (profile: RoleProfile): boolean => profile.role === 'admin' || profile.role === 'platform_owner'
/** the manager tier as a whole (either of the two above) */
export const isManagerTier = (profile: RoleProfile): boolean => MANAGER_TIER.has(profile.role)

/** Pure rule, so it can be tested without a database. `namedApprover` = the person is named on at least one approval step. */
export function rolesFor(profile: RoleProfile, namedApprover: boolean): BridgeRole[] {
  const out: BridgeRole[] = ['requester']
  if (AGENT_TIER.has(profile.role)) out.push('technician')
  if (MANAGER_TIER.has(profile.role) || namedApprover) out.push('approver')
  if (isHierarchyManager(profile)) out.push('manager')
  if (isOrgWide(profile)) out.push('orgwide')
  return out.sort() as BridgeRole[]
}

/** A vendor (OEM engineer) login never uses the assistant. */
export const mayUseAssistant = (profile: RoleProfile): boolean => !isVendor(profile)

export async function isNamedApprover(userId: string): Promise<boolean> {
  const { count, error } = await createAdminClient().from('approval_workflow_steps').select('id', { count: 'exact', head: true }).eq('approver_user_id', userId)
  if (error) throw new Error('Could not read approval steps')
  return (count ?? 0) > 0
}

export async function computeRoles(profile: RoleProfile): Promise<BridgeRole[]> {
  const manager = MANAGER_TIER.has(profile.role)
  return rolesFor(profile, manager ? false : await isNamedApprover(profile.id))
}
