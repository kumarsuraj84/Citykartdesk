import { getEnabledModules } from '@/lib/queries/profiles'
import type { ModuleSlug } from '@/types'

/**
 * Shared server-side module-enablement guard for Server Actions.
 *
 * lib/actions/{requests,tasks,projects}.ts already each inline this exact
 * check ("is this org's `requests`/`tasks`/`projects` module enabled?")
 * before doing anything else. lib/actions/intake/*.ts never did — Intake was
 * only gated at the UI layer (Sidebar/MobileNav hiding the nav links via
 * `navVisibility.enabledModules`), so a disabled-module org's users could
 * still invoke any Intake Server Action directly (the client bundle ships a
 * callable reference to every 'use server' export regardless of what the
 * sidebar shows — hiding a link is not the same as guarding the action it
 * points to).
 *
 * This is now the one shared check, so future module-gated action files
 * don't have to reinvent (or forget) it.
 */
export async function requireModuleEnabled(module: ModuleSlug): Promise<string | null> {
  const enabledModules = await getEnabledModules()
  if (!enabledModules.includes(module)) {
    return `The ${module} module is not enabled for your organisation.`
  }
  return null
}
