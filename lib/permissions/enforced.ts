// The per-role permission matrix and custom roles (tables permission_overrides / custom_roles) are NOT read by anything that decides access: what a role may do
// comes from lib/permissions/matrix.ts and the platform policies. Until a real check reads these tables, the screen only shows them (read only) and the server
// actions below refuse to write them, so a crafted call cannot leave rows that look like authority but have none (audit A-18).
// Switch this to true ONLY together with the code that makes the tables decide access. app/(app)/admin/roles/PermissionMatrixClient.tsx imports this same switch.
export const PERMISSION_MATRIX_ENFORCED = false

export const PERMISSION_MATRIX_NOT_ENABLED_MESSAGE = 'Custom permissions are not switched on yet, so this change was not saved.'
