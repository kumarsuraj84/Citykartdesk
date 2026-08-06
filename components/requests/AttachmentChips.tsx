import { Paperclip, FileText, FileSpreadsheet, Image, File } from 'lucide-react'
import type { RequestAttachmentWithUploader } from '@/types'

interface AttachmentChipsProps {
  attachments: RequestAttachmentWithUploader[]
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image
  if (mimeType === 'application/pdf') return FileText
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'text/csv'
  )
    return FileSpreadsheet
  return File
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentChips({ attachments }: AttachmentChipsProps) {
  if (attachments.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">
          {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((att) => {
          const Icon = fileIcon(att.mime_type)
          return (
            <a
              key={att.id}
              href={att.signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={att.file_name}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
              <span className="max-w-[160px] truncate font-medium text-foreground group-hover:text-primary">
                {att.file_name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatBytes(att.file_size)}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
