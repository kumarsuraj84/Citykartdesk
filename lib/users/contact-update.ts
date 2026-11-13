// "Update employee codes and mobile numbers" from a sheet.
//
// The sheet is the truth for exactly two things, for people who ALREADY have an account (matched by e-mail):
//   - employee code:  sheet has a value -> the person gets it;  sheet cell is empty -> the code is cleared.
//   - mobile number:  sheet has a value -> that is the person's one number;  sheet cell is empty -> the person's number is cleared.
// Nothing else is ever touched (not the e-mail, name, role, store, location, manager, password, status ...). A column that is not in the file at all
// is left alone for everybody (only a column that IS in the file, with an empty cell, means "clear").
//
// This file only DECIDES (it is pure: no database, no network) so the rules can be tested on their own. lib/actions/admin/users.ts reads the current state,
// calls planContactUpdate(), shows the plan, and (only when the administrator confirms) writes it.

import { normalizeMobileNumber } from '@/lib/users/mobile'

export const EMPLOYEE_ID_MAX = 60

export type ContactSheetRow = { email?: string; employee_id?: string; mobile_number?: string }

export type ContactAccount = {
  id: string
  role: string
  employeeId: string | null
  /** every number registered to this profile, normalised (bare 10 digits) */
  mobiles: string[]
}

export type FieldPlan<T> =
  | { kind: 'unchanged' }
  | { kind: 'change'; before: T; after: T | null }
  | { kind: 'skipped'; reason: string }
  | { kind: 'not_in_file' }

export type RowPlan = {
  rowLabel: string
  email: string
  profileId: string | null
  employee: FieldPlan<string | null>
  mobile: FieldPlan<string | null>
  /** why the whole row was skipped (account not found, e-mail twice ...) */
  rowError?: string
}

export type PlanOptions = {
  /** the file has an employee_id column / a mobile_number column */
  hasEmployeeColumn: boolean
  hasMobileColumn: boolean
  /** may the caller change this person? (the "only a platform owner changes an administrator" rule) -> error text or null */
  guard: (account: ContactAccount, field: 'employee' | 'mobile') => string | null
}

/** Which profile holds which number in the whole organisation (normalised number -> profile id). */
export type MobileOwners = Map<string, string>

export type ContactPlan = {
  rows: RowPlan[]
  counts: {
    rowsInFile: number
    peopleFound: number
    notFound: number
    employeeSet: number
    employeeCleared: number
    employeeUnchanged: number
    mobileSet: number
    mobileCleared: number
    mobileUnchanged: number
    skipped: number
  }
  /** one plain sentence per problem, ready to show */
  problems: string[]
}

export function planContactUpdate(
  rows: ContactSheetRow[],
  accounts: Map<string, ContactAccount>,
  owners: MobileOwners,
  opts: PlanOptions
): ContactPlan {
  const plans: RowPlan[] = []
  const problems: string[] = []

  // ---- pre-pass: in-file duplicates (a number or a code on two rows blocks BOTH rows, so nobody gets the wrong one silently) ----
  const rowsByEmail = new Map<string, number[]>()
  const rowsByMobile = new Map<string, number[]>()
  const rowsByCode = new Map<string, number[]>()
  const normalisedMobile = new Map<number, { ok: true; value: string } | { ok: false; error: string } | null>()
  rows.forEach((r, i) => {
    const email = (r.email ?? '').trim().toLowerCase()
    if (email) rowsByEmail.set(email, [...(rowsByEmail.get(email) ?? []), i])
    const rawMobile = (r.mobile_number ?? '').trim()
    if (opts.hasMobileColumn && rawMobile) {
      const n = normalizeMobileNumber(rawMobile)
      if (n.ok) {
        normalisedMobile.set(i, { ok: true, value: n.normalized })
        rowsByMobile.set(n.normalized, [...(rowsByMobile.get(n.normalized) ?? []), i])
      } else normalisedMobile.set(i, { ok: false, error: n.error })
    } else normalisedMobile.set(i, null)
    const code = (r.employee_id ?? '').trim().toLowerCase()
    if (opts.hasEmployeeColumn && code) rowsByCode.set(code, [...(rowsByCode.get(code) ?? []), i])
  })
  const label = (i: number) => `Row ${i + 2}`

  const counts: ContactPlan['counts'] = {
    rowsInFile: rows.length, peopleFound: 0, notFound: 0,
    employeeSet: 0, employeeCleared: 0, employeeUnchanged: 0,
    mobileSet: 0, mobileCleared: 0, mobileUnchanged: 0, skipped: 0,
  }

  rows.forEach((r, i) => {
    const email = (r.email ?? '').trim().toLowerCase()
    const base: RowPlan = { rowLabel: label(i), email, profileId: null, employee: { kind: 'not_in_file' }, mobile: { kind: 'not_in_file' } }
    const skipRow = (why: string) => {
      plans.push({ ...base, rowError: why })
      problems.push(`${label(i)} (${email || 'no e-mail'}): ${why}`)
      counts.skipped++
    }
    if (!email) return skipRow('e-mail is empty, skipped.')
    if ((rowsByEmail.get(email) ?? []).length > 1) return skipRow(`this e-mail is on more than one row (${(rowsByEmail.get(email) ?? []).map((x) => x + 2).join(', ')}), skipped.`)
    const acct = accounts.get(email)
    if (!acct) { counts.notFound++; return skipRow('no account with this e-mail, skipped (this tool never creates accounts).') }
    counts.peopleFound++
    base.profileId = acct.id

    // ---- employee code ----
    if (opts.hasEmployeeColumn) {
      const wanted = (r.employee_id ?? '').trim()
      const current = (acct.employeeId ?? '').trim()
      const guard = opts.guard(acct, 'employee')
      if (guard) { base.employee = { kind: 'skipped', reason: guard }; problems.push(`${label(i)} (${email}): employee code: ${guard}`); counts.skipped++ }
      else if (wanted.length > EMPLOYEE_ID_MAX) { base.employee = { kind: 'skipped', reason: `longer than ${EMPLOYEE_ID_MAX} characters` }; problems.push(`${label(i)} (${email}): employee code is longer than ${EMPLOYEE_ID_MAX} characters, not changed.`); counts.skipped++ }
      else if (wanted && (rowsByCode.get(wanted.toLowerCase()) ?? []).length > 1) {
        const others = (rowsByCode.get(wanted.toLowerCase()) ?? []).filter((x) => x !== i).map((x) => x + 2).join(', ')
        base.employee = { kind: 'skipped', reason: 'same code on another row' }
        problems.push(`${label(i)} (${email}): employee code "${wanted}" is also on Row ${others}, not changed (fix the sheet).`); counts.skipped++
      }
      else if (wanted === current) { base.employee = { kind: 'unchanged' }; counts.employeeUnchanged++ }
      else if (!wanted) { base.employee = { kind: 'change', before: current, after: null }; counts.employeeCleared++ }
      else { base.employee = { kind: 'change', before: current || null, after: wanted }; counts.employeeSet++ }
    }

    // ---- mobile number ----
    if (opts.hasMobileColumn) {
      const norm = normalisedMobile.get(i)
      const guard = opts.guard(acct, 'mobile')
      const rawNumbers = acct.mobiles
      if (guard) { base.mobile = { kind: 'skipped', reason: guard }; problems.push(`${label(i)} (${email}): mobile number: ${guard}`); counts.skipped++ }
      else if (norm && !norm.ok) { base.mobile = { kind: 'skipped', reason: norm.error }; problems.push(`${label(i)} (${email}): mobile number "${(r.mobile_number ?? '').trim()}": ${norm.error}`); counts.skipped++ }
      else if (norm && norm.ok && (rowsByMobile.get(norm.value) ?? []).length > 1) {
        const others = (rowsByMobile.get(norm.value) ?? []).filter((x) => x !== i).map((x) => x + 2).join(', ')
        base.mobile = { kind: 'skipped', reason: 'same number on another row' }
        problems.push(`${label(i)} (${email}): mobile number is also on Row ${others}, not changed (fix the sheet).`); counts.skipped++
      }
      else if (norm && norm.ok && owners.has(norm.value) && owners.get(norm.value) !== acct.id) {
        base.mobile = { kind: 'skipped', reason: 'number belongs to another user' }
        problems.push(`${label(i)} (${email}): this mobile number already belongs to another user, not changed.`); counts.skipped++
      }
      else if (rawNumbers.length > 1) {
        // a shared login (for example a store used from several phones): one number in the sheet cannot describe it, so it is left alone
        base.mobile = { kind: 'skipped', reason: `has ${rawNumbers.length} numbers` }
        problems.push(`${label(i)} (${email}): has ${rawNumbers.length} mobile numbers (a shared login), not changed. Edit it by hand on the user.`); counts.skipped++
      }
      else if (norm && norm.ok) {
        if (rawNumbers.length === 1 && rawNumbers[0] === norm.value) { base.mobile = { kind: 'unchanged' }; counts.mobileUnchanged++ }
        else { base.mobile = { kind: 'change', before: rawNumbers[0] ?? null, after: norm.value }; counts.mobileSet++ }
      } else {
        // the cell is empty
        if (rawNumbers.length === 0) { base.mobile = { kind: 'unchanged' }; counts.mobileUnchanged++ }
        else { base.mobile = { kind: 'change', before: rawNumbers[0], after: null }; counts.mobileCleared++ }
      }
    }
    plans.push(base)
  })

  return { rows: plans, counts, problems }
}
