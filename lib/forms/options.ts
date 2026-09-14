import type { FormFieldOption } from '@/types'

/**
 * Strip archived options out of a select/multiselect option tree for
 * "what can be newly chosen" contexts (the live request-submission form,
 * the admin builder's preview). Archived options are never deleted from the
 * underlying array — see FormFieldOption.is_active — this only controls what's
 * offered going forward. A group whose every child is archived is dropped too;
 * an archived group with still-active children keeps only those children.
 */
export function filterActiveOptions(options: FormFieldOption[] | undefined): FormFieldOption[] {
  if (!options) return []
  const out: FormFieldOption[] = []
  for (const opt of options) {
    if (opt.children?.length) {
      const activeChildren = filterActiveOptions(opt.children)
      if (opt.is_active === false || activeChildren.length === 0) continue
      out.push({ ...opt, children: activeChildren })
    } else if (opt.is_active !== false) {
      out.push(opt)
    }
  }
  return out
}

/**
 * Flatten a (possibly nested) option tree down to its active leaf values only,
 * dropping group headers. Used wherever a flat list of selectable values is
 * needed (e.g. the field-level SLA matrix, one row per leaf option).
 */
export function flattenLeafOptions(
  options: FormFieldOption[] | undefined
): { value: string; label: string }[] {
  return filterActiveOptions(options).flatMap((opt) =>
    opt.children?.length
      ? flattenLeafOptions(opt.children)
      : [{ value: opt.value, label: opt.label }]
  )
}

/**
 * Same leaf-flattening as flattenLeafOptions(), but WITHOUT dropping archived
 * (is_active === false) options. For validating a value that's already been
 * submitted (lib/validation/formFields.ts's option-membership check) — an
 * option that was active when a request was created must keep validating as
 * a legitimate value forever, even after being retired, the same way it must
 * keep resolving to its label forever (see FormFieldOption.is_active). Use
 * flattenLeafOptions() instead when the context is offering NEW choices.
 */
export function flattenAllLeafOptions(
  options: FormFieldOption[] | undefined
): { value: string; label: string }[] {
  if (!options) return []
  return options.flatMap((opt) =>
    opt.children?.length
      ? flattenAllLeafOptions(opt.children)
      : [{ value: opt.value, label: opt.label }]
  )
}
