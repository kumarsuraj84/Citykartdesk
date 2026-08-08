'use client'

import { useTransition, useState } from 'react'
import { Loader2, Download } from 'lucide-react'
import { downloadCSV } from '@/lib/export/csv'

interface ExportButtonProps {
  action: () => Promise<string>
  filename: string
  label?: string
}

export function ExportButton({ action, filename, label = 'Export CSV' }: ExportButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      try {
        const csv = await action()
        downloadCSV(filename.endsWith('.csv') ? filename : `${filename}.csv`, csv)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed.'
        setError(msg)
        console.error('[ExportButton]', err)
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="btn-glossy-light btn-glossy-light-hover disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {isPending ? 'Exporting…' : label}
      </button>
      {error && (
        <p className="max-w-xs text-right text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
