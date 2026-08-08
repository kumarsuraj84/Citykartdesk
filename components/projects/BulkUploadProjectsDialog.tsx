'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { ImportModal } from '@/components/ui/ImportModal'
import { bulkCreateProjects } from '@/lib/actions/projects'

export function BulkUploadProjectsDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors"
      >
        <Upload className="h-3.5 w-3.5" />
        Upload CSV
      </button>

      {open && (
        <ImportModal
          title="Projects"
          sampleFilename="projects-sample.csv"
          sampleColumns={[
            { key: 'name', label: 'name' },
            { key: 'description', label: 'description' },
            { key: 'owner', label: 'owner' },
            { key: 'team', label: 'team' },
            { key: 'status', label: 'status' },
            { key: 'start_date', label: 'start_date' },
            { key: 'target_date', label: 'target_date' },
          ]}
          sampleRows={[
            {
              name: 'Store Rollout Q3', description: 'Open 12 new stores', owner: 'Jane Doe',
              team: 'Retail Operations', status: 'in_progress', start_date: '2026-07-01', target_date: '2026-09-30',
            },
            { name: 'POS Migration', description: '', owner: '', team: '', status: 'not_started', start_date: '', target_date: '' },
          ]}
          onImport={(rows) => bulkCreateProjects(rows as never)}
          onClose={() => setOpen(false)}
          onDone={() => router.refresh()}
        />
      )}
    </>
  )
}
