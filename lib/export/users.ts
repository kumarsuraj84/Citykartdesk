// Users export. The first block of columns matches the bulk-import template
// (components/admin/BulkImportUsersDialog.tsx) so an exported file can be edited
// and re-imported to add people; passwords are never exported. The columns after
// it are reference-only and ignored by the importer.

export const USER_EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'full_name', label: 'full_name' },
  { key: 'email', label: 'email' },
  { key: 'role', label: 'role' },
  { key: 'department', label: 'department' },
  { key: 'location', label: 'location' },
  { key: 'store', label: 'store' },
  { key: 'job_title', label: 'job_title' },
  { key: 'employee_id', label: 'employee_id' },
  { key: 'manager_email', label: 'manager_email' },
  { key: 'mobile_number', label: 'mobile_number' },
  { key: 'whatsapp_enabled', label: 'whatsapp_enabled' },
  // reference-only
  { key: 'status', label: 'status' },
  { key: 'teams', label: 'teams' },
  { key: 'all_mobile_numbers', label: 'all_mobile_numbers' },
  { key: 'job_function', label: 'job_function' },
  { key: 'designation', label: 'designation' },
  { key: 'cost_center', label: 'cost_center' },
  { key: 'created_at', label: 'created_at' },
]

export type ExportProfile = {
  id: string
  full_name: string
  role: string
  is_active: boolean
  whatsapp_enabled: boolean
  job_title: string | null
  employee_id: string | null
  department_id: string | null
  location_id: string | null
  store_id: string | null
  manager_id: string | null
  function_id: string | null
  designation_id: string | null
  cost_center_id: string | null
  created_at: string
}

type Named = { id: string; name: string }

export type UsersExportInput = {
  profiles: ExportProfile[]
  emailById: Map<string, string>
  departments: Named[]
  locations: Named[]
  stores: { id: string; code: string }[]
  jobFunctions: Named[]
  designations: Named[]
  costCenters: Named[]
  mobileNumbersById: Map<string, string[]>
  teamNamesById: Map<string, string[]>
}

export function buildUsersExportRows(input: UsersExportInput): Record<string, string>[] {
  const nameOf = (list: Named[]) => new Map(list.map((x) => [x.id, x.name]))
  const dept = nameOf(input.departments)
  const loc = nameOf(input.locations)
  const fn = nameOf(input.jobFunctions)
  const desig = nameOf(input.designations)
  const cc = nameOf(input.costCenters)
  const storeCode = new Map(input.stores.map((s) => [s.id, s.code]))

  return input.profiles.map((p) => {
    const numbers = input.mobileNumbersById.get(p.id) ?? []
    return {
      full_name: p.full_name ?? '',
      email: input.emailById.get(p.id) ?? '',
      role: p.role,
      department: (p.department_id && dept.get(p.department_id)) || '',
      location: (p.location_id && loc.get(p.location_id)) || '',
      store: (p.store_id && storeCode.get(p.store_id)) || '',
      job_title: p.job_title ?? '',
      employee_id: p.employee_id ?? '',
      manager_email: (p.manager_id && input.emailById.get(p.manager_id)) || '',
      mobile_number: numbers[0] ?? '',
      whatsapp_enabled: p.whatsapp_enabled ? 'true' : 'false',
      status: p.is_active ? 'active' : 'inactive',
      teams: (input.teamNamesById.get(p.id) ?? []).join('; '),
      all_mobile_numbers: numbers.join('; '),
      job_function: (p.function_id && fn.get(p.function_id)) || '',
      designation: (p.designation_id && desig.get(p.designation_id)) || '',
      cost_center: (p.cost_center_id && cc.get(p.cost_center_id)) || '',
      created_at: p.created_at ? p.created_at.slice(0, 10) : '',
    }
  })
}
