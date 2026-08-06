// Work-item source options ("Source" column on Tasks/Requests).
// Predefined in code — add new entries here and they appear in the editable
// Source dropdown everywhere. `intake` is set automatically by the intake
// conversion pipeline; the rest are picked manually by a user.
export type WorkSource = 'intake' | 'manual' | 'email' | 'phone' | 'portal'

export const WORK_SOURCES: { key: WorkSource; label: string }[] = [
  { key: 'intake', label: 'Intake' },
  { key: 'manual', label: 'Manual' },
  { key: 'email',  label: 'Email' },
  { key: 'phone',  label: 'Phone' },
  { key: 'portal', label: 'Portal' },
]

export function sourceLabel(key: string | null | undefined): string | null {
  if (!key) return null
  return WORK_SOURCES.find((s) => s.key === key)?.label ?? null
}
