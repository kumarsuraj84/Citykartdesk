// The names the reports file a ticket under when a technician, category or sub category is missing.

export const UNASSIGNED = 'Unassigned'
export const NO_CATEGORY = '(No category)'
export const NO_SUB_CATEGORY = '(No sub category)'

/** The technician, category and sub category names a ticket is filed under (blank ones become the placeholders). */
export const techOf = (v: string | null | undefined) => (v ?? '').trim() || UNASSIGNED
export const catOf = (v: string | null | undefined) => (v ?? '').trim() || NO_CATEGORY
export const subOf = (v: string | null | undefined) => (v ?? '').trim() || NO_SUB_CATEGORY
