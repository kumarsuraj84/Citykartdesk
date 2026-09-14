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
  // A broad service no longer owns a single category/sub-category — it's
  // tagged to a SET of allowed sub-categories instead (service_sub_category_tags),
  // and the requester picks one per submission. See allowedSubCategories below
  // and resolveServiceFormSections() in lib/forms/sections.ts for the template.
  team: Team
  approval_workflow: ApprovalWorkflow | null
  // Owner/backup_owner are always fetched as a lean projection (id, full_name, avatar_url) —
  // see SERVICE_SELECT in lib/queries/services.ts. Kept as a Pick rather than the full Profile
  // so the type matches what every query site actually returns.
  owner: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
  backup_owner: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
  escalation_policy: EscalationPolicy | null
  // Live source of truth for the form when set — see resolveServiceFormSections()
  // in lib/forms/sections.ts. Null means this service still owns its own
  // form_sections/form_fields (untagged/legacy).
  template: { id: string; name: string; form_sections: unknown } | null
  // The SLA Policy this service is mapped to (services.sla_policy_id) — the
  // source of truth resolveSlaDeadlines() looks up hours from. Null means no
  // SLA is configured for this service.
  sla_policy: { id: string; name: string; config: SLAConfig } | null
}

/** A sub-category this service is tagged to — the requester picks one of
 *  these (grouped by category) as a built-in field on the submission form. */
export type AllowedSubCategory = {
  id: string
  name: string
  category_id: string
  category_name: string
}

export type ServiceCategoryWithSubCategories = ServiceCategory & {
  sub_categories: ServiceSubCategory[]
}

export type RequestWithRelations = Request & {
  requester: Profile
  assignee: Profile | null
  service: Service
  category: { id: string; name: string } | null
  sub_category: { id: string; name: string } | null
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
  | 'phone'
  | 'file'
  | 'toggle'
  // Always system-populated from the requester's own store master record
  // (stores.address) — never requester-editable, regardless of
  // requester_can_set. Empty for HO/Warehouse requesters (no store_id).
  // See createRequest() in lib/actions/requests.ts and FieldRenderer.tsx.
  | 'store_address'

export type FormFieldOption = {
  value: string
  label: string
  children?: FormFieldOption[]
  /** Archived options are hidden from new selections but never removed from the
   *  array — historical requests read from a frozen form_sections_snapshot, so an
   *  option that was in use when a request was submitted must keep resolving to
   *  its label forever, even after being retired. Undefined/true = active. */
  is_active?: boolean
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
  /** Whether a requester can see this field at all — on their own create-request
   *  form and later when re-viewing this request. Absent/undefined means `true`,
   *  which is what makes this a zero-migration addition: every field saved
   *  before this existed (including every frozen form_sections_snapshot on an
   *  existing request) has no such key and silently keeps behaving as "fully
   *  requester-visible" forever. See lib/forms/sections.ts's requesterCanView(). */
  requester_can_view?: boolean
  /** Whether a requester can set/edit this field's value themselves. Absent/
   *  undefined means `true`, matching every existing field's actual behavior
   *  today. Requires requester_can_view to also be true — can't let someone
   *  set a value in a field they can't see.
   *
   *  `required` stays a single flag, but its audience is derived from these
   *  two: required && requesterCanView && requesterCanSet is mandatory for the
   *  requester at submission time; required && !(both) is mandatory for the
   *  technician instead, enforced when they try to change the ticket's status
   *  (see updateRequestStatus() in lib/actions/requests.ts). See
   *  lib/forms/sections.ts's requesterCanSet()/isRequesterMandatory()/
   *  isTechnicianMandatory(). */
  requester_can_set?: boolean
  /** Stage 7.1 — explicit, opt-in mapping of this field to a value the
   *  conversational engine (WhatsApp today) already collects on its own:
   *  `request_title` -> auto-filled from the engine's generated title,
   *  `request_description` -> auto-filled from the requester's captured
   *  description. Undefined/null (the default for every field, including
   *  every field saved before this existed) means "an ordinary field" —
   *  asked normally, never auto-filled. Deliberately NEVER inferred from
   *  `label`/`type`/position (Stage 3.1's "no label-guessing" principle) —
   *  a template author must set this explicitly, per field, per template.
   *  Only consulted by the conversational engine
   *  (lib/conversations/orchestrator.ts); the web form and Email Intake
   *  ignore it entirely and keep asking/showing the field as today. */
  semantic_role?: 'request_title' | 'request_description' | null
}

// ============================================================
// SLA config (stored in sla_policies.config; also field_sla_overrides.sla_config)
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

/** A reusable, named SLA table (e.g. "IT SLA") — created once in Service Desk
 *  → SLA Policies, then mapped onto one or more Services (services.sla_policy_id). */
export type SlaPolicy = {
  id: string
  org_id: string
  name: string
  description: string | null
  config: SLAConfig
  is_active: boolean
  created_at: string
  updated_at: string
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
