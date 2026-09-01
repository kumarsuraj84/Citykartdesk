'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Plus, Trash2, ChevronDown, ChevronRight, Edit2, Save,
  ArrowUp, ArrowDown, GitMerge, Link2, Unlink,
} from 'lucide-react'
import {
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  upsertWorkflowStep,
  deleteWorkflowStep,
  bindWorkflowToService,
  fetchWorkflowSteps,
} from '@/lib/actions/admin/workflows'
import type { ApprovalWorkflowSummary, ApprovalWorkflowStep } from '@/lib/queries/admin'
import { ROLE_LABELS } from '@/lib/constants/roles'

// ── Types ─────────────────────────────────────────────────────────────────────

type Service = {
  id: string
  name: string
  slug: string
  approval_workflow_id: string | null
  is_active: boolean
}

type Approver = {
  id: string
  full_name: string
  role: string
}

type WorkflowWithSteps = ApprovalWorkflowSummary & {
  steps: ApprovalWorkflowStep[]
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({
  step,
  workflowId,
  totalSteps,
  approvers,
  onDeleted,
  onMoved,
  onSaved,
}: {
  step: ApprovalWorkflowStep
  workflowId: string
  totalSteps: number
  approvers: Approver[]
  onDeleted: (id: string) => void
  onMoved: (id: string, direction: 'up' | 'down') => void
  onSaved: (updated: ApprovalWorkflowStep) => void
}) {
  const [editing, setEditing]       = useState(false)
  const [approverType, setApproverType] = useState<'specific_user' | 'any_manager'>(step.approver_type)
  const [approverUserId, setApproverUserId] = useState(step.approver_user_id ?? '')
  const [error, setError]           = useState('')
  const [isPending, start]          = useTransition()

  function handleSave() {
    setError('')
    start(async () => {
      const result = await upsertWorkflowStep({
        id: step.id,
        workflowId,
        stepOrder: step.step_order,
        approverType,
        approverUserId: approverType === 'specific_user' ? approverUserId || null : null,
      })
      if (result.error) { setError(result.error); return }
      const approverProfile = approvers.find((a) => a.id === approverUserId) ?? null
      onSaved({
        ...step,
        approver_type: approverType,
        approver_user_id: approverType === 'specific_user' ? (approverUserId || null) : null,
        approver: approverProfile ? { id: approverProfile.id, full_name: approverProfile.full_name } : null,
      })
      setEditing(false)
    })
  }

  function handleDelete() {
    if (!confirm('Remove this approval step?')) return
    setError('')
    start(async () => {
      const result = await deleteWorkflowStep(step.id)
      if (result.error) { setError(result.error); return }
      onDeleted(step.id)
    })
  }

  const approverLabel =
    step.approver_type === 'any_manager'
      ? 'Any Manager / Admin'
      : step.approver?.full_name ?? 'Unknown user'

  if (editing) {
    return (
      <div className="rounded-lg border border-ring bg-muted/30 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {step.step_order}
          </span>
          <select
            value={approverType}
            onChange={(e) => setApproverType(e.target.value as 'specific_user' | 'any_manager')}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="any_manager">Any Manager / Admin</option>
            <option value="specific_user">Specific User</option>
          </select>
          {approverType === 'specific_user' && (
            <select
              value={approverUserId}
              onChange={(e) => setApproverUserId(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— select approver —</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name} ({(ROLE_LABELS as Record<string, string>)[a.role] ?? a.role})</option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="btn-gradient"
          >
            <Save className="h-3 w-3" /> Save
          </button>
          <button
            onClick={() => { setEditing(false); setError('') }}
            className="btn-soft"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 group">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          {step.step_order}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {step.approver_type === 'any_manager' ? 'Any Manager' : 'Specific User'}
          </span>
          <p className="text-sm text-foreground truncate">{approverLabel}</p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onMoved(step.id, 'up')}
            disabled={step.step_order === 1 || isPending}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            onClick={() => onMoved(step.id, 'down')}
            disabled={step.step_order === totalSteps || isPending}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Edit2 className="h-3 w-3" />
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ── Workflow card ─────────────────────────────────────────────────────────────

function WorkflowCard({
  workflow: initialWorkflow,
  allServices,
  approvers,
  onDeleted,
}: {
  workflow: WorkflowWithSteps
  allServices: Service[]
  approvers: Approver[]
  onDeleted: (id: string) => void
}) {
  const [workflow, setWorkflow]     = useState(initialWorkflow)
  const [expanded, setExpanded]     = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [name, setName]             = useState(workflow.name)
  const [steps, setSteps]           = useState<ApprovalWorkflowStep[]>(workflow.steps)
  const [stepsLoaded, setStepsLoaded] = useState(false)
  const [loadingSteps, setLoadingSteps] = useState(false)
  const [showAddStep, setShowAddStep] = useState(false)
  const [newApproverType, setNewApproverType] = useState<'specific_user' | 'any_manager'>('any_manager')
  const [newApproverUserId, setNewApproverUserId] = useState('')
  const [addError, setAddError]     = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [bindError, setBindError]   = useState('')
  const [isPending, start]          = useTransition()

  function toggleExpanded() {
    const next = !expanded
    setExpanded(next)
    if (next && !stepsLoaded) {
      setLoadingSteps(true)
      start(async () => {
        const result = await fetchWorkflowSteps(workflow.id)
        setLoadingSteps(false)
        setStepsLoaded(true)
        if (result.data) setSteps(result.data)
      })
    }
  }

  function handleRename() {
    if (!name.trim() || name === workflow.name) { setEditingName(false); return }
    start(async () => {
      const result = await updateWorkflow(workflow.id, name)
      if (!result.error) {
        setWorkflow((prev) => ({ ...prev, name }))
        setEditingName(false)
      }
    })
  }

  function handleDelete() {
    setDeleteError('')
    start(async () => {
      const result = await deleteWorkflow(workflow.id)
      if (result.error) { setDeleteError(result.error); return }
      onDeleted(workflow.id)
    })
  }

  function handleAddStep() {
    setAddError('')
    start(async () => {
      const result = await upsertWorkflowStep({
        workflowId: workflow.id,
        stepOrder: steps.length + 1,
        approverType: newApproverType,
        approverUserId: newApproverType === 'specific_user' ? (newApproverUserId || null) : null,
      })
      if (result.error) { setAddError(result.error); return }
      const approverProfile = approvers.find((a) => a.id === newApproverUserId) ?? null
      const newStep: ApprovalWorkflowStep = {
        id: result.data!.id,
        workflow_id: workflow.id,
        step_order: steps.length + 1,
        approver_type: newApproverType,
        approver_user_id: newApproverType === 'specific_user' ? (newApproverUserId || null) : null,
        approver: approverProfile ? { id: approverProfile.id, full_name: approverProfile.full_name } : null,
      }
      setSteps((prev) => [...prev, newStep])
      setWorkflow((prev) => ({ ...prev, step_count: prev.step_count + 1 }))
      setNewApproverType('any_manager')
      setNewApproverUserId('')
      setShowAddStep(false)
    })
  }

  async function handleMoveStep(stepId: string, direction: 'up' | 'down') {
    const idx = steps.findIndex((s) => s.id === stepId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= steps.length) return

    const a = steps[idx]
    const b = steps[swapIdx]

    // Optimistically reorder
    const prevSteps = steps
    const reordered = steps.map((s) => {
      if (s.id === a.id) return { ...s, step_order: b.step_order }
      if (s.id === b.id) return { ...s, step_order: a.step_order }
      return s
    }).sort((x, y) => x.step_order - y.step_order)
    setSteps(reordered)

    // Persist both
    const [ra, rb] = await Promise.all([
      upsertWorkflowStep({ id: a.id, workflowId: workflow.id, stepOrder: b.step_order, approverType: a.approver_type, approverUserId: a.approver_user_id }),
      upsertWorkflowStep({ id: b.id, workflowId: workflow.id, stepOrder: a.step_order, approverType: b.approver_type, approverUserId: b.approver_user_id }),
    ])
    if (ra.error || rb.error) {
      toast.error(ra.error ?? rb.error ?? 'Failed to reorder step.')
      setSteps(prevSteps)
    }
  }

  async function handleBind(serviceId: string, currentlyBound: boolean) {
    setBindError('')
    const result = await bindWorkflowToService(
      currentlyBound ? null : workflow.id,
      serviceId
    )
    if (result.error) { setBindError(result.error); return }

    setWorkflow((prev) => {
      const svc = allServices.find((s) => s.id === serviceId)
      if (!svc) return prev
      if (currentlyBound) {
        return { ...prev, services: prev.services.filter((s) => s.id !== serviceId) }
      } else {
        return { ...prev, services: [...prev.services, { id: svc.id, name: svc.name, slug: svc.slug }] }
      }
    })
  }

  const boundServiceIds = new Set(workflow.services.map((s) => s.id))

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <button
          onClick={toggleExpanded}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') { setName(workflow.name); setEditingName(false) }
            }}
            className="flex-1 rounded-lg border border-ring bg-background px-2 py-1 text-sm font-semibold focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex-1 text-left text-sm font-semibold text-foreground hover:text-primary"
          >
            {workflow.name}
          </button>
        )}

        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {workflow.step_count} step{workflow.step_count !== 1 ? 's' : ''}
        </span>
        {workflow.services.length > 0 && (
          <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600">
            {workflow.services.length} service{workflow.services.length !== 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={handleDelete}
          disabled={isPending}
          title={workflow.services.length > 0 ? 'Unbind from all services first' : 'Delete workflow'}
          className="rounded-lg p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {deleteError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">
          {deleteError}
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="divide-y divide-border/40">
          {/* Steps section */}
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Approval Steps
            </h3>

            {loadingSteps ? (
              <p className="py-3 text-center text-xs text-muted-foreground">Loading steps…</p>
            ) : steps.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No steps yet. Add a step below.
              </p>
            ) : (
              steps.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  workflowId={workflow.id}
                  totalSteps={steps.length}
                  approvers={approvers}
                  onDeleted={(id) => {
                    const removed = steps.find((s) => s.id === id)
                    const remaining = steps
                      .filter((s) => s.id !== id)
                      .map((s, i) => ({ ...s, step_order: i + 1 }))
                    setSteps(remaining)
                    if (removed) setWorkflow((prev) => ({ ...prev, step_count: prev.step_count - 1 }))
                  }}
                  onMoved={handleMoveStep}
                  onSaved={(updated) =>
                    setSteps((prev) => prev.map((s) => s.id === updated.id ? updated : s))
                  }
                />
              ))
            )}

            {/* Add step */}
            {showAddStep ? (
              <div className="rounded-lg border border-ring bg-muted/30 p-3 space-y-2 mt-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {steps.length + 1}
                  </span>
                  <select
                    value={newApproverType}
                    onChange={(e) => setNewApproverType(e.target.value as 'specific_user' | 'any_manager')}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="any_manager">Any Manager / Admin</option>
                    <option value="specific_user">Specific User</option>
                  </select>
                  {newApproverType === 'specific_user' && (
                    <select
                      value={newApproverUserId}
                      onChange={(e) => setNewApproverUserId(e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— select approver —</option>
                      {approvers.map((a) => (
                        <option key={a.id} value={a.id}>{a.full_name} ({(ROLE_LABELS as Record<string, string>)[a.role] ?? a.role})</option>
                      ))}
                    </select>
                  )}
                </div>
                {addError && <p className="text-xs text-red-500">{addError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddStep}
                    disabled={isPending}
                    className="btn-gradient"
                  >
                    <Plus className="h-3 w-3" /> Add Step
                  </button>
                  <button
                    onClick={() => { setShowAddStep(false); setAddError('') }}
                    className="btn-soft"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddStep(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors mt-2"
              >
                <Plus className="h-3.5 w-3.5" /> Add Step
              </button>
            )}
          </div>

          {/* Services binding section */}
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Bound Services
            </h3>
            {allServices.length === 0 ? (
              <p className="text-xs text-muted-foreground">No services available.</p>
            ) : (
              <div className="space-y-1.5">
                {allServices.map((svc) => {
                  const isBound = boundServiceIds.has(svc.id)
                  return (
                    <div
                      key={svc.id}
                      className="flex items-center gap-3 rounded-lg border border-border/50 bg-background px-3 py-2"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${svc.is_active ? 'bg-green-400' : 'bg-muted-foreground/30'}`} />
                      <span className="flex-1 text-sm text-foreground truncate">{svc.name}</span>
                      {isBound && (
                        <span className="rounded-full bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                          bound
                        </span>
                      )}
                      <button
                        onClick={() => handleBind(svc.id, isBound)}
                        disabled={isPending}
                        title={isBound ? 'Unbind workflow from this service' : 'Bind workflow to this service'}
                        className={`rounded p-1 transition-colors disabled:opacity-40 ${
                          isBound
                            ? 'text-blue-500 hover:text-red-500 hover:bg-red-50'
                            : 'text-muted-foreground hover:text-blue-500 hover:bg-blue-50'
                        }`}
                      >
                        {isBound ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {bindError && <p className="text-xs text-red-500 mt-1">{bindError}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

export function WorkflowBuilderClient({
  initialWorkflows,
  services,
  approvers,
}: {
  initialWorkflows: ApprovalWorkflowSummary[]
  services: Service[]
  approvers: Approver[]
}) {
  const [workflows, setWorkflows] = useState<WorkflowWithSteps[]>(
    initialWorkflows.map((w) => ({ ...w, steps: [] }))
  )
  const [showForm, setShowForm]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [createError, setCreateError] = useState('')
  const [isPending, start]        = useTransition()

  function handleCreate() {
    if (!newName.trim()) return
    setCreateError('')
    start(async () => {
      const result = await createWorkflow(newName.trim())
      if (result.error) { setCreateError(result.error); return }
      const newWorkflow: WorkflowWithSteps = {
        id: result.data!.id,
        name: newName.trim(),
        description: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        step_count: 0,
        services: [],
        steps: [],
      }
      setWorkflows((prev) => [newWorkflow, ...prev])
      setNewName('')
      setShowForm(false)
    })
  }

  return (
    <div className="space-y-3">
      {/* Create new workflow */}
      {showForm ? (
        <div className="rounded-xl border border-ring bg-card p-3 space-y-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setShowForm(false); setCreateError('') }
            }}
            placeholder="Workflow name (e.g. Manager Approval)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending || !newName.trim()}
              className="btn-gradient"
            >
              Create
            </button>
            <button
              onClick={() => { setShowForm(false); setCreateError('') }}
              className="btn-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
        >
          <Plus className="h-4 w-4" />
          New Workflow
        </button>
      )}

      {/* Workflow list */}
      {workflows.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-border bg-card">
          <GitMerge className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No workflows yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create a workflow to enable multi-step approvals on services.
          </p>
        </div>
      ) : (
        workflows.map((w) => (
          <WorkflowCard
            key={w.id}
            workflow={w}
            allServices={services}
            approvers={approvers}
            onDeleted={(id) => setWorkflows((prev) => prev.filter((wf) => wf.id !== id))}
          />
        ))
      )}
    </div>
  )
}
