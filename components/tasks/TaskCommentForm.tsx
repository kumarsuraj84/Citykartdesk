'use client'

import { useState, useTransition, useRef } from 'react'
import { Loader2, Send } from 'lucide-react'
import { addTaskComment } from '@/lib/actions/tasks'

interface TaskCommentFormProps {
  taskId: string
}

export function TaskCommentForm({ taskId }: TaskCommentFormProps) {
  const [body, setBody]              = useState('')
  const [error, setError]            = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const textareaRef                  = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addTaskComment(taskId, body)
      if (result.error) {
        setError(result.error)
      } else {
        setBody('')
        textareaRef.current?.focus()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative rounded-xl border border-border bg-background">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          rows={3}
          className="w-full resize-none rounded-xl bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={isPending || !body.trim()}
          className="btn-gradient disabled:opacity-40"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {isPending ? 'Posting…' : 'Post'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </form>
  )
}
