'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Download, KeyRound } from 'lucide-react'
import { ImportModal } from '@/components/ui/ImportModal'
import { bulkCreateUsers, type BulkCredential, type BulkOnboarding } from '@/lib/actions/admin/users'

// A CSV cell that starts with = + - @ is read as a formula by spreadsheet programs: neutralise it (passwords can start with such a character)
const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`

export function BulkImportUsersDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [onboarding, setOnboarding] = useState<BulkOnboarding>('random_password')
  const [credentials, setCredentials] = useState<BulkCredential[] | null>(null)

  function downloadCredentials() {
    if (!credentials) return
    const csv = ['email,full_name,one_time_password', ...credentials.map((c) => [c.email, c.full_name, c.password].map(cell).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'new-users-one-time-passwords.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-glossy-light btn-glossy-light-hover"
      >
        <Upload className="h-3.5 w-3.5" />
        Import
      </button>

      {open && (
        <ImportModal
          title="Users"
          sampleFilename="users-sample.csv"
          sampleColumns={[
            { key: 'full_name', label: 'full_name' },
            { key: 'email', label: 'email' },
            { key: 'role', label: 'role' },
            { key: 'password', label: 'password' },
            { key: 'department', label: 'department' },
            { key: 'location', label: 'location' },
            { key: 'store', label: 'store' },
            { key: 'job_title', label: 'job_title' },
            { key: 'employee_id', label: 'employee_id' },
            { key: 'manager_email', label: 'manager_email' },
            { key: 'mobile_number', label: 'mobile_number' },
            { key: 'whatsapp_enabled', label: 'whatsapp_enabled' },
          ]}
          sampleRows={[
            {
              full_name: 'Priya Sharma', email: 'priya.sharma@citykart.org', role: 'agent',
              password: '', department: 'IT Support', location: 'HO', store: '', job_title: 'IT Executive', employee_id: 'EMP1042', manager_email: '',
              mobile_number: '9876543210', whatsapp_enabled: 'true',
            },
            {
              full_name: 'Rahul Verma', email: 'rahul.verma@citykart.org', role: 'user',
              password: '', department: 'HR', location: 'Stores', store: 'ALC', job_title: '', employee_id: '', manager_email: 'priya.sharma@citykart.org',
              mobile_number: '', whatsapp_enabled: '',
            },
          ]}
          note={
            <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground">
              <p className="mb-2 font-medium">Rows without a password</p>
              <label className="flex items-start gap-2">
                <input type="radio" name="onboarding" checked={onboarding === 'random_password'} onChange={() => setOnboarding('random_password')} className="mt-0.5" />
                <span><b>Give each person their own random one-time password</b> (shown to you once, after the import, as a CSV to hand over). They must choose their own at first sign-in.</span>
              </label>
              <label className="mt-1.5 flex items-start gap-2">
                <input type="radio" name="onboarding" checked={onboarding === 'invite'} onChange={() => setOnboarding('invite')} className="mt-0.5" />
                <span><b>E-mail each person a link to set their own password</b> (needs a working mailbox for each person).</span>
              </label>
            </div>
          }
          onImport={async (rows) => {
            const res = await bulkCreateUsers(rows as never, { onboarding })
            if (res.data?.credentials?.length) setCredentials(res.data.credentials)
            return res
          }}
          onClose={() => setOpen(false)}
          onDone={() => router.refresh()}
        />
      )}

      {credentials && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="One-time passwords">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><KeyRound className="h-4 w-4" /> One-time passwords for {credentials.length} new user(s)</div>
            <p className="mb-3 text-xs text-muted-foreground">
              These passwords are shown <b>only now</b> and are not stored anywhere readable. Download the file and give each person their password privately.
              Everyone must choose their own password at first sign-in. Delete the file once handed over.
            </p>
            <div className="flex gap-2">
              <button onClick={downloadCredentials} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
                <Download className="h-3.5 w-3.5" /> Download CSV
              </button>
              <button onClick={() => setCredentials(null)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted">I have saved it — close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
