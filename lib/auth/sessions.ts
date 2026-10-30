// Ends every sign-in session of a person (audit A-05). The auth client can only sign out the CALLER'S own session ("scope: others" of a password change);
// an administrator who resets someone's password or changes their e-mail address cannot do it through it. The database function public.revoke_user_sessions
// (migration 192; service role only) deletes that person's sessions and refresh tokens, so a stolen or old session cannot be renewed after the reset.
// A page already open keeps working until its current access token expires (the token lifetime of the sign-in service, 1 hour by default): that is a property
// of the tokens, not something this can change.

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }> }

/** Best effort: returns the number of sessions ended, or null when it could not be done (the caller then adds a warning, the reset itself stands). */
export async function revokeAllSessions(admin: RpcClient, userId: string): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc('revoke_user_sessions', { p_user_id: userId })
    if (error) return null
    return typeof data === 'number' ? data : 0
  } catch { return null }
}
