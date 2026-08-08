'use client'

import { useRef, useState, useTransition } from 'react'
import { Pencil, Check, X, Camera, KeyRound } from 'lucide-react'
import { updateProfile, uploadAvatar, sendPasswordResetEmail } from '@/lib/actions/profile'

export function EditableName({ initialName }: { initialName: string }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [draft, setDraft] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleEdit() {
    setDraft(name)
    setError(null)
    setEditing(true)
  }

  function handleCancel() {
    setEditing(false)
    setError(null)
  }

  function handleSave() {
    if (!draft.trim() || draft.trim() === name) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const result = await updateProfile({ full_name: draft.trim() })
      if (result.error) {
        setError(result.error)
      } else {
        setName(draft.trim())
        setEditing(false)
      }
    })
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
            disabled={isPending}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 w-56"
          />
          <button
            type="button"
            title="Save"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Cancel"
            onClick={handleCancel}
            disabled={isPending}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">{name}</span>
      <button
        type="button"
        title="Edit name"
        onClick={handleEdit}
        className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function AvatarUpload({
  initials,
  currentUrl,
}: {
  initials: string
  currentUrl?: string | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    const fd = new FormData()
    fd.append('avatar', file)
    startTransition(async () => {
      const result = await uploadAvatar(fd)
      if (result.error) {
        setError(result.error)
        setPreview(currentUrl ?? null)
      }
    })
  }

  return (
    <div className="relative h-16 w-16 shrink-0">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- preview can be a local blob: object URL (unsupported by next/image) or a Supabase storage URL not in next.config's remote patterns
        <img
          src={preview}
          alt="Avatar"
          className="h-16 w-16 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
          {initials}
        </div>
      )}
      <button
        type="button"
        title="Upload photo"
        onClick={() => fileRef.current?.click()}
        disabled={isPending}
        className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-card border border-border shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
      >
        <Camera className="h-3 w-3" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      {error && (
        <p className="absolute top-full mt-1 w-48 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}

export function PasswordResetButton() {
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleReset() {
    startTransition(async () => {
      const result = await sendPasswordResetEmail()
      if (result.error) {
        setError(result.error)
        setStatus('error')
      } else {
        setStatus('sent')
      }
    })
  }

  if (status === 'sent') {
    return (
      <span className="text-sm text-emerald-600 font-medium">
        Password reset email sent — check your inbox.
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleReset}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:opacity-50 transition-colors"
      >
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        {isPending ? 'Sending…' : 'Send reset email'}
      </button>
      {status === 'error' && error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
