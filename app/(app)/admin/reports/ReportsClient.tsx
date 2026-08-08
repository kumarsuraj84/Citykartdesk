'use client'

import { useState } from 'react'
import { ExportButton } from '@/components/requests/ExportButton'
import { exportRequests, exportTasks, exportApprovals } from '@/lib/actions/export'

const REQUEST_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_user', label: 'Waiting on User' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const TASK_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

const APPROVAL_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}

function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-[140px]">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ReportsClient() {
  // Requests filters
  const [reqStatus, setReqStatus] = useState('')
  const [reqFrom, setReqFrom] = useState('')
  const [reqTo, setReqTo] = useState('')

  // Tasks filters
  const [taskStatus, setTaskStatus] = useState('')
  const [taskFrom, setTaskFrom] = useState('')
  const [taskTo, setTaskTo] = useState('')

  // Approvals filters
  const [appStatus, setAppStatus] = useState('')
  const [appFrom, setAppFrom] = useState('')
  const [appTo, setAppTo] = useState('')

  return (
    <div className="space-y-6">
      {/* Requests */}
      <SectionCard title="Requests Report">
        <FilterRow>
          <Field label="Status">
            <select value={reqStatus} onChange={(e) => setReqStatus(e.target.value)} className={inputCls}>
              {REQUEST_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Created From">
            <input type="date" value={reqFrom} onChange={(e) => setReqFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Created To">
            <input type="date" value={reqTo} onChange={(e) => setReqTo(e.target.value)} className={inputCls} />
          </Field>
          <ExportButton
            action={() =>
              exportRequests({
                status: reqStatus || undefined,
                date_from: reqFrom || undefined,
                date_to: reqTo || undefined,
              })
            }
            filename="requests.csv"
          />
        </FilterRow>
      </SectionCard>

      {/* Tasks */}
      <SectionCard title="Tasks Report">
        <FilterRow>
          <Field label="Status">
            <select value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)} className={inputCls}>
              {TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Created From">
            <input type="date" value={taskFrom} onChange={(e) => setTaskFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Created To">
            <input type="date" value={taskTo} onChange={(e) => setTaskTo(e.target.value)} className={inputCls} />
          </Field>
          <ExportButton
            action={() =>
              exportTasks({
                status: taskStatus || undefined,
                date_from: taskFrom || undefined,
                date_to: taskTo || undefined,
              })
            }
            filename="tasks.csv"
          />
        </FilterRow>
      </SectionCard>

      {/* Approvals */}
      <SectionCard title="Approvals Report">
        <FilterRow>
          <Field label="Status">
            <select value={appStatus} onChange={(e) => setAppStatus(e.target.value)} className={inputCls}>
              {APPROVAL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Created From">
            <input type="date" value={appFrom} onChange={(e) => setAppFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Created To">
            <input type="date" value={appTo} onChange={(e) => setAppTo(e.target.value)} className={inputCls} />
          </Field>
          <ExportButton
            action={() =>
              exportApprovals({
                status: appStatus || undefined,
                date_from: appFrom || undefined,
                date_to: appTo || undefined,
              })
            }
            filename="approvals.csv"
          />
        </FilterRow>
      </SectionCard>
    </div>
  )
}
