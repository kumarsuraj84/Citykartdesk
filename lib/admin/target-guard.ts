// Who may change WHOM. Audit finding D-009: the admin actions that set a password, change a role or deactivate an account checked the CALLER's
// role and the role being assigned, but never the role of the person being changed. A plain admin could therefore set a platform owner's
// password (and sign in as them), or demote or deactivate them. (The sibling "change e-mail" action already had this rule.)
//
//   - Only a platform owner may change an admin or a platform owner.
//   - Nobody changes their own role or deactivates themselves (that would lock the last administrator out or escalate by accident).
//   - A person may set their own password through this action (it is the same person).

export type TargetAction = 'role' | 'active' | 'password' | 'profile' | 'phone' | 'teams'
type Who = { id: string; role: string }

export function targetGuardError(caller: Who, target: Who, action: TargetAction): string | null {
  const isSelf = caller.id === target.id
  if (isSelf && (action === 'role' || action === 'active')) {
    return action === 'role' ? 'You cannot change your own role.' : 'You cannot deactivate or reactivate your own account.'
  }
  // A mobile number decides who the WhatsApp channel believes a sender is, so only an administrator may attach one to somebody (a manager could otherwise
  // attach their own phone to an administrator and raise tickets as them). A manager also cannot change their own technician groups.
  if (action === 'phone' && caller.role !== 'admin' && caller.role !== 'platform_owner') return 'Only an administrator can change mobile numbers.'
  if (action === 'teams' && isSelf && caller.role === 'manager') return 'You cannot change your own technician groups.'
  const targetIsPrivileged = target.role === 'admin' || target.role === 'platform_owner'
  if (targetIsPrivileged && caller.role !== 'platform_owner' && !(isSelf && action === 'password')) {
    return `Only a platform owner can change an "${target.role}" account.`
  }
  return null
}
