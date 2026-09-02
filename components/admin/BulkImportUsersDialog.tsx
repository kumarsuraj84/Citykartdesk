'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { ImportModal } from '@/components/ui/ImportModal'
import { bulkCreateUsers } from '@/lib/actions/admin/users'

export function BulkImportUsersDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

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
            { key: 'job_title', label: 'job_title' },
            { key: 'employee_id', label: 'employee_id' },
            { key: 'manager_email', label: 'manager_email' },
          ]}
          sampleRows={[
            {
              full_name: 'Priya Sharma', email: 'priya.sharma@citykart.org', role: 'agent',
              password: '', department: 'IT Support', job_title: 'IT Executive', employee_id: 'EMP1042', manager_email: '',
            },
            {
              full_name: 'Rahul Verma', email: 'rahul.verma@citykart.org', role: 'user',
              password: '', department: 'HR', job_title: '', employee_id: '', manager_email: 'priya.sharma@citykart.org',
            },
          ]}
          onImport={(rows) => bulkCreateUsers(rows as never)}
          onClose={() => setOpen(false)}
          onDone={() => router.refresh()}
        />
      )}
    </>
  )
}
