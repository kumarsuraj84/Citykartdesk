'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Paperclip, FileText, FileSpreadsheet, Image, File, X } from 'lucide-react'
import { deleteAttachment } from '@/lib/actions/attachments'
import { AttachmentPreviewModal } from './AttachmentPreviewModal'
import { useAttachmentGallery } from './AttachmentGallery'
import type { GalleryItem } from '@/lib/attachments/gallery-order'
import type { RequestAttachmentWithUploader } from '@/types'

interface AttachmentChipsProps {
  attachments: RequestAttachmentWithUploader[]
  currentUserId: string
  canManageAll: boolean
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

export function AttachmentChips({ attachments: initialAttachments, currentUserId, canManageAll }: AttachmentChipsProps) {
  const [attachments, setAttachments] = useState(initialAttachments)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const gallery = useAttachmentGallery()
  const [isPending, startTransition] = useTransition()

  // Re-sync when someone else adds/removes an attachment and the page's own periodic
  // refresh (AppShell's AutoRefresh) hands this component a fresh list — same pattern as
  // RequestSidebarPanel's CollaboratorsRow.
  const [prevInitial, setPrevInitial] = useState(initialAttachments)
  if (prevInitial !== initialAttachments) {
    setPrevInitial(initialAttachments)
    setAttachments(initialAttachments)
  }

  if (attachments.length === 0) return null

  // The arrows in the preview walk through every file of the ticket when the page provides them
  // (see AttachmentGallery); a chip row used on its own just walks through its own files.
  const ownItems: GalleryItem[] = attachments.map((a) => ({ id: a.id, file_name: a.file_name, file_size: a.file_size, mime_type: a.mime_type, signedUrl: a.signedUrl }))
  const previewItems = previewingId && gallery?.some((g) => g.id === previewingId) ? gallery : ownItems
  const previewIndex = previewingId ? previewItems.findIndex((i) => i.id === previewingId) : -1

  function handleDelete(id: string) {
    if (!confirm('Delete this attachment?')) return
    const prev = attachments
    setAttachments((cur) => cur.filter((a) => a.id !== id))
    startTransition(async () => {
      const result = await deleteAttachment(id)
      if (result.error) { toast.error(result.error); setAttachments(prev) }
    })
  }

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
          const canDelete = canManageAll || att.uploaded_by === currentUserId
          return (
            <div
              key={att.id}
              className="group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <button
                type="button"
                title="Preview"
                onClick={() => setPreviewingId(att.id)}
                className="flex items-center gap-2 min-w-0 text-left"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                <span className="max-w-[160px] truncate font-medium text-foreground group-hover:text-primary">
                  {att.file_name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatBytes(att.file_size)}
                </span>
              </button>
              {canDelete && (
                <button
                  type="button"
                  title="Delete attachment"
                  disabled={isPending}
                  onClick={() => handleDelete(att.id)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {previewIndex >= 0 && (
        <AttachmentPreviewModal
          items={previewItems}
          index={previewIndex}
          onIndexChange={(n) => { const next = previewItems[n]; if (next) setPreviewingId(next.id) }}
          onClose={() => setPreviewingId(null)}
        />
      )}
    </div>
  )
}
