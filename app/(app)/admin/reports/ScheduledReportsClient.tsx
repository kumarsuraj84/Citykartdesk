'use client'

import { useState, useTransition, useRef, KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  sendScheduledReport,
} from '@/lib/actions/admin/reports'

type ReportType = 'requests' | 'tasks' | 'approvals'
type Frequency = 'daily' | 'weekly' | 'monthly'

interface ScheduledReport {
  id: string
  name: string
  report_type: ReportType
  frequency: Frequency
  recipients: string[]
  filters: Record<string, unknown>
  is_active: boolean
  last_sent_at: string | null
  created_at: string
}

interface Props {
  reports: ScheduledReport[]
}

const TYPE_COLORS: Record<ReportType, string> = {
  requests: 'bg-blue-100 text-blue-700',
  tasks: 'bg-purple-100 text-purple-700',
  approvals: 'bg-amber-100 text-amber-700',
}

const FREQ_LABELS: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

interface FormState {
  name: string
  report_type: ReportType
  frequency: Frequency
  recipients: string[]
  is_active: boolean
}

const defaultForm = (): FormState => ({
  name: '',
  report_type: 'requests',
  frequency: 'weekly',
  recipients: [],
  is_active: true,
})

function ReportModal({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string
  initial: FormState
  onSave: (f: FormState) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addEmail(raw: string) {
    const email = raw.trim().replace(/,+$/, '')
    if (!email || form.recipients.includes(email)) {
      setEmailInput('')
      return
    }
    setForm(f => ({ ...f, recipients: [...f.recipients, email] }))
    setEmailInput('')
  }

  function handleEmailKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addEmail(emailInput)
    } else if (e.key === 'Backspace' && !emailInput && form.recipients.length > 0) {
      setForm(f => ({ ...f, recipients: f.recipients.slice(0, -1) }))
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    if (form.recipients.length === 0) { setError('At least one recipient is required.'); return }
    setSaving(true)
    setError('')
    await onSave(form)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Weekly Requests Summary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.report_type}
                onChange={e => setForm(f => ({ ...f, report_type: e.target.value as ReportType }))}
              >
                <option value="requests">Requests</option>
                <option value="tasks">Tasks</option>
                <option value="approvals">Approvals</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value as Frequency }))}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recipients</label>
            <div
              className="min-h-[42px] w-full border border-gray-300 rounded-lg px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-blue-500"
              onClick={() => inputRef.current?.focus()}
            >
              {form.recipients.map(r => (
                <span
                  key={r}
                  className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full"
                >
                  {r}
                  <button
                    type="button"
                    className="hover:text-blue-600"
                    onClick={() => setForm(f => ({ ...f, recipients: f.recipients.filter(x => x !== r) }))}
                  >
                    &times;
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                className="flex-1 min-w-[120px] text-sm outline-none bg-transparent"
                placeholder={form.recipients.length === 0 ? 'Type email, press Enter or comma' : ''}
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={handleEmailKey}
                onBlur={() => { if (emailInput.trim()) addEmail(emailInput) }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={form.is_active}
              onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${form.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-gray-700">Active</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ScheduledReportsClient({ reports: initialReports }: Props) {
  const router = useRouter()
  const [reports, setReports] = useState(initialReports)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<ScheduledReport | null>(null)
  const [isPending, startTransition] = useTransition()
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  function toast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  async function handleCreate(form: FormState) {
    const res = await createScheduledReport({ ...form, filters: {} })
    if (res.error) { toast('Error: ' + res.error); return }
    setShowCreate(false)
    toast('Report scheduled.')
    // Reload by refreshing — Next.js server actions revalidate path, so we trigger a soft reload
    startTransition(() => { router.refresh() })
  }

  async function handleUpdate(form: FormState) {
    if (!editTarget) return
    const res = await updateScheduledReport(editTarget.id, { ...form, filters: editTarget.filters })
    if (res.error) { toast('Error: ' + res.error); return }
    setEditTarget(null)
    toast('Report updated.')
    startTransition(() => { router.refresh() })
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this scheduled report?')) return
    const res = await deleteScheduledReport(id)
    if (res.error) { toast('Error: ' + res.error); return }
    setReports(r => r.filter(x => x.id !== id))
    toast('Report deleted.')
  }

  async function handleSendNow(id: string) {
    setSendingId(id)
    const res = await sendScheduledReport(id)
    setSendingId(null)
    if (res.error) { toast('Error: ' + res.error); return }
    toast('Report sent.')
    startTransition(() => { router.refresh() })
  }

  function handleToggleActive(report: ScheduledReport) {
    startTransition(async () => {
      const res = await updateScheduledReport(report.id, { is_active: !report.is_active })
      if (res.error) { toast('Error: ' + res.error); return }
      setReports(r => r.map(x => x.id === report.id ? { ...x, is_active: !x.is_active } : x))
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {toastMsg && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toastMsg}
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Scheduled Reports</h2>
          <p className="text-sm text-gray-500 mt-0.5">Automatically email CSV reports to recipients.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <span className="text-base leading-none">+</span> New Report
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-gray-400">
          No scheduled reports yet. Click &ldquo;New Report&rdquo; to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Last Sent</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {reports.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_COLORS[r.report_type]}`}>
                      {r.report_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{FREQ_LABELS[r.frequency]}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.recipients.length} {r.recipients.length === 1 ? 'recipient' : 'recipients'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      role="switch"
                      aria-checked={r.is_active}
                      onClick={() => handleToggleActive(r)}
                      disabled={isPending}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${r.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${r.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {r.last_sent_at
                      ? new Date(r.last_sent_at).toLocaleDateString()
                      : <span className="text-gray-300">Never</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleSendNow(r.id)}
                        disabled={sendingId === r.id}
                        className="px-2.5 py-1 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
                      >
                        {sendingId === r.id ? 'Sending…' : 'Send Now'}
                      </button>
                      <button
                        onClick={() => setEditTarget(r)}
                        className="px-2.5 py-1 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="px-2.5 py-1 text-xs rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <ReportModal
          title="New Scheduled Report"
          initial={defaultForm()}
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editTarget && (
        <ReportModal
          title="Edit Scheduled Report"
          initial={{
            name: editTarget.name,
            report_type: editTarget.report_type,
            frequency: editTarget.frequency,
            recipients: editTarget.recipients,
            is_active: editTarget.is_active,
          }}
          onSave={handleUpdate}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}
