'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { ImportModal } from '@/components/ui/ImportModal'
import { bulkImportCategories } from '@/lib/actions/admin/categories'

export function BulkImportCategoriesDialog() {
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
          title="Categories"
          sampleFilename="categories-sample.csv"
          sampleColumns={[
            { key: 'category_name', label: 'category_name' },
            { key: 'category_description', label: 'category_description' },
            { key: 'category_icon', label: 'category_icon' },
            { key: 'sub_category_name', label: 'sub_category_name' },
            { key: 'sub_category_description', label: 'sub_category_description' },
            { key: 'sub_category_icon', label: 'sub_category_icon' },
            { key: 'sla_priority', label: 'sla_priority' },
          ]}
          sampleRows={[
            {
              category_name: 'IT Support', category_description: 'Hardware and software issues',
              category_icon: '💻', sub_category_name: 'Laptop Issue', sub_category_description: 'Laptop hardware or performance problems',
              sub_category_icon: '', sla_priority: 'medium',
            },
            {
              category_name: 'IT Support', category_description: 'Hardware and software issues',
              category_icon: '💻', sub_category_name: 'Internet Issue', sub_category_description: '',
              sub_category_icon: '', sla_priority: 'high',
            },
            {
              category_name: 'HR', category_description: 'Human resources requests',
              category_icon: '🧑‍💼', sub_category_name: 'Leave Application', sub_category_description: '',
              sub_category_icon: '', sla_priority: '',
            },
          ]}
          onImport={(rows) => bulkImportCategories(rows as never)}
          onClose={() => setOpen(false)}
          onDone={() => router.refresh()}
        />
      )}
    </>
  )
}
