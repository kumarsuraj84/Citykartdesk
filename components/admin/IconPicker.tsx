'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload, X, ImageIcon } from 'lucide-react'
import { uploadIconImage } from '@/lib/actions/admin/icons'

interface IconPickerProps {
  emoji: string
  onEmojiChange: (v: string) => void
  imageUrl: string | null
  onImageChange: (v: string | null) => void
}

// Combined emoji-or-uploaded-image icon editor for Services/Categories/
// Sub-Categories — the image takes priority over the emoji whenever it's
// set. Mirrors AvatarUpload's interaction pattern (app/(app)/profile/ProfileClient.tsx):
// hidden file input, instant local preview via a blob URL, upload in the
// background, revert on error.
export function IconPicker({ emoji, onEmojiChange, imageUrl, onImageChange }: IconPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(imageUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    const fd = new FormData()
    fd.append('icon', file)
    startTransition(async () => {
      const result = await uploadIconImage(fd)
      if (result.error) {
        setError(result.error)
        setPreview(imageUrl)
      } else if (result.url) {
        setPreview(result.url)
        onImageChange(result.url)
      }
    })
    e.target.value = ''
  }

  function handleRemove() {
    setPreview(null)
    onImageChange(null)
    setError(null)
  }

  return (
    <div className="w-24 shrink-0 space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">Icon</label>
      <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-2xl">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview can be a local blob: object URL or a Supabase storage URL
          <img src={preview} alt="Icon" className="h-full w-full object-cover" />
        ) : emoji ? (
          <span>{emoji}</span>
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
        )}
        {preview && (
          <button
            type="button"
            title="Remove image"
            onClick={handleRemove}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card/90 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-1 rounded-md border border-border px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <Upload className="h-3 w-3" />
        {isPending ? 'Uploading…' : 'Upload'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      {!preview && (
        <input
          type="text"
          value={emoji}
          onChange={(e) => onEmojiChange(e.target.value)}
          placeholder="📋"
          maxLength={4}
          className="w-full rounded-md border border-border bg-background px-1.5 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      )}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  )
}
