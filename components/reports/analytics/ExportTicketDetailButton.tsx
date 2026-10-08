'use client'

import { useTransition } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { exportTicketDetailReportXlsx } from '@/lib/actions/analyticsReportExport'
import { downloadXlsxBase64 } from '@/lib/export/xlsx'

export function ExportTicketDetailButton({ slug, group, services, preset, from, to, statuses, technician, bucket }: {
  slug: string
  group: string
  services: string[]
  preset: string
  from: string
  to: string
  statuses: string[]
  technician: string
  bucket: string
}) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await exportTicketDetailReportXlsx(slug, { group, service: services, preset, from, to, status: statuses, technician, bucket })
        if (res.error || !res.data || !res.filename) { toast.error(res.error || 'Export failed.'); return }
        downloadXlsxBase64(res.filename, res.data)
        toast.success('Report exported.')
      })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Export to Excel
    </button>
  )
}
