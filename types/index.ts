import type { Tables, Enums } from './database'

// ============================================================
// Base table row types
// ============================================================
export type Profile = Tables<'profiles'>
export type Organization = Tables<'organizations'>
export type OrgModuleAccess = Tables<'org_module_access'>
export type Team = Tables<'teams'>
export type Department = Tables<'departments'>
export type TeamMember = Tables<'team_members'>
export type ServiceCategory = Tables<'service_categories'>
export type ServiceSubCategory = Tables<'service_sub_categories'>
export type Service = Tables<'services'>
export type Request = Tables<'requests'>
export type RequestComment = Tables<'request_comments'>
export type RequestActivity = Tables<'request_activity'>
export type Approval = Tables<'approvals'>
export type ApprovalDecision = Tables<'approval_decisions'>
export type ApprovalWorkflow = Tables<'approval_workflows'>
export type ApprovalWorkflowStep = Tables<'approval_workflow_steps'>
export type Task = Tables<'tasks'>
export type Notification = Tables<'notifications'>
export type NotificationPreference = Tables<'notification_preferences'>
export type RequestAttachment = Tables<'request_attachments'>
export type AppSetting = Tables<'app_settings'>
export type Project = Tables<'projects'>
export type ProjectActivity = Tables<'project_activity'>

// ============================================================
// Enum types
// ============================================================
export type UserRole = Enums<'user_role'>
export type OrgStatus = Enums<'org_status'>
export type ModuleSlug = Enums<'module_slug'>
export type RequestStatus = Enums<'request_status'>
export type RequestPriority = Enums<'request_priority'>
export type TaskType = Enums<'task_type'>
export type TaskStatus = Enums<'task_status'>
export type TaskPriority = Enums<'task_priority'>
export type ApprovalStatus = Enums<'approval_status'>
export type ApprovalDecisionType = Enums<'approval_decision_type'>
export type ApproverType = Enums<'approver_type'>
export type ActivityAction = Enums<'activity_action'>
export type NotificationType = Enums<'notification_type'>
export type ProjectStatus = Enums<'project_status'>
export type ProjectPriority = Enums<'project_priority'>

// ============================================================
// Enriched types (with joins)
// ============================================================
export type ProfileWithTeams = Profile & {
  team_members: (TeamMember & { team: Team })[]
}

export type TeamWithDepartment = Team & {
  department: Department
}

export type EscalationPolicy = {
  id: string
  org_id: string
  name: string
  description: string | null
  rules: EscalationRule[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export type EscalationRule = {
  after_minutes: number
  action: 'notify_backup_owner' | 'notify_manager' | 'reassign_team_lead'
  notify_roles?: string[]
}

export type VisibilityScope = {
  audience: 'all' | 'agents_only' | 'specific_teams'
  team_ids?: string[]
}

export type ServiceWithRelations = Service & {
  category: ServiceCategory
  sub_category: ServiceSubCategory | null
  team: Team
  approval_workflow: ApprovalWorkflow | null
  // Owner/backup_owner are always fetched as a lean projection (id, full_name, avatar_url) —
  // see SERVICE_SELECT in lib/queries/services.ts. Kept as a Pick rather than the full Profile
  // so the type matches what every query site actually returns.
  owner: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
  backup_owner: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
  escalation_policy: EscalationPolicy | null
}

export type ServiceSubCategoryWithServices = ServiceSubCategory & {
  services: ServiceWithRelations[]
}

export type ServiceCategoryWithSubCategories = ServiceCategory & {
  sub_categories: ServiceSubCategoryWithServices[]
}

export type RequestWithRelations = Request & {
  requester: Profile
  assignee: Profile | null
  service: Service
  team: Team
}

export type RequestCommentWithAuthor = RequestComment & {
  author: Pick<Profile, 'id' | 'full_name'>
}

export type RequestAttachmentWithUploader = RequestAttachment & {
  uploader: Pick<Profile, 'id' | 'full_name'>
  /** Fresh signed URL generated server-side at render time. Never stored. */
  signedUrl: string
}

export type RequestActivityWithActor = RequestActivity & {
  actor: Pick<Profile, 'id' | 'full_name'> | null
}

export type NotificationWithActor = Notification & {
  actor: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
}

export type TaskWithRelations = Task & {
  assignee: Profile | null
  created_by_profile: Profile
  team: Team | null
  request: Pick<Request, 'id' | 'request_no' | 'title'> | null
}

export type ApprovalWithRelations = Approval & {
  workflow: ApprovalWorkflow & {
    approval_workflow_steps: ApprovalWorkflowStep[]
  }
  approval_decisions: (ApprovalDecision & { decider: Profile })[]
  request: Pick<Request, 'id' | 'request_no' | 'title' | 'requester_id'> & {
    requester: Profile
  }
}

// ============================================================
// Dynamic form field definition (stored in services.form_fields)
// ============================================================
export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'email'
  | 'file'
  | 'toggle'

export type FormFieldOption = {
  value: string
  label: string
  children?: FormFieldOption[]
}

export type FormField = {
  id: string
  type: FormFieldType
  label: string
  placeholder?: string
  help_text?: string
  required: boolean
  order: number
  options?: FormFieldOption[]
  validation?: {
    min?: number
    max?: number
    min_length?: number
    max_length?: number
  }
}

// ============================================================
// SLA config (stored in services.sla_config)
// ============================================================
// Form section definition (stored in services.form_sections)
// Phase 2: section-based form architecture.
// Backward compat: if form_sections is empty, fall back to form_fields.
// ============================================================
export type FormSection = {
  /** Stable UUID used as React key and for form_data field-id scoping */
  id: string
  title: string
  description?: string
  /** 0-based display order across sections */
  order: number
  /** Builder/renderer UI hint — section starts collapsed */
  collapsed_by_default?: boolean
  fields: FormField[]
}

// ============================================================
export type SLATier = {
  response_hours: number | null
  resolution_hours: number | null
}

export type SLAConfig = {
  low?: SLATier
  medium?: SLATier
  high?: SLATier
  urgent?: SLATier
}

// ============================================================
// SLA state (derived at render time — not stored)
// ============================================================
export type SLAState = 'none' | 'on_track' | 'at_risk' | 'breached'

// ============================================================
// Activity metadata shapes
// ============================================================
export type ActivityMetadata =
  | { from: RequestStatus; to: RequestStatus }
  | { assigned_to: string; assigned_to_name: string }
  | { priority_from: RequestPriority; priority_to: RequestPriority }
  | { comment: string }
  | Record<string, never>

// ============================================================
// Collaborators
// ============================================================
export type RequestCollaborator = {
  id: string
  user_id: string
  added_by: string
  added_at: string
  profile: { id: string; full_name: string }
}

// ============================================================
// Task enriched types (shared between server queries and client components)
// ============================================================

type ProfileMini = Pick<Tables<'profiles'>, 'id' | 'full_name'>

export type TaskWithDetails = Tables<'tasks'> & {
  assignee: ProfileMini | null
  creator: ProfileMini
  subtask_count?: number
}

export type TaskCommentWithAuthor = Tables<'task_comments'> & {
  author: ProfileMini
}

export type TaskActivityWithActor = Tables<'task_activity'> & {
  actor: ProfileMini | null
}

// ============================================================
// Project enriched types
// ============================================================

export type ProjectWithDetails = Tables<'projects'> & {
  owner: ProfileMini
  functional_owner: ProfileMini | null
  team: Pick<Tables<'teams'>, 'id' | 'name'> | null
}

export type Milestone = Tables<'milestones'>

export type MilestoneWithDetails = Tables<'milestones'> & {
  owner: ProfileMini | null
  functional_owner: ProfileMini | null
}

export type ProjectMemberWithProfile = Tables<'project_members'> & {
  user: ProfileMini
}

export type ProjectUpdateWithAuthor = Tables<'project_updates'> & {
  author: ProfileMini
}

export type ProjectActivityWithActor = Tables<'project_activity'> & {
  actor: ProfileMini | null
}

export type ProjectProgress = {
  not_started: number
  in_progress: number
  blocked: number
  done: number
  cancelled: number
  total: number
}

// ============================================================
// Custom task fields
// ============================================================
export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'multi_select' | 'checkbox'

export type CustomFieldOption = { value: string; color?: string }

export type CustomField = {
  id: string
  team_id: string
  name: string
  field_type: CustomFieldType
  options: CustomFieldOption[] | null
  position: number
  created_by: string | null
  created_at: string
}

export type CustomFieldValue = {
  field_id: string
  value: string | number | boolean | string[] | null
}

export type TaskWithCustomFields = TaskWithDetails & {
  customValues?: Record<string, CustomFieldValue['value']>
}

// ============================================================
// Navigation helpers
// ============================================================
export type NavVisibility = {
  isAgent: boolean
  isTeamLead: boolean
  isManager: boolean
  isAdmin: boolean
  hasPendingApprovals: boolean
  enabledModules: ModuleSlug[]
}
