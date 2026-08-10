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
