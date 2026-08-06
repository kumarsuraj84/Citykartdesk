'use client'

import { useState, useTransition, useRef } from 'react'
import { updateTaskField } from '@/lib/actions/tasks'

interface TaskInlineTitleProps {
  taskId: string
  initialTitle: string
}

export function TaskInlineTitle({ taskId, initialTitle }: TaskInlineTitleProps) {
  const [editing, setEditing]        = useState(false)
  const [value, setValue]            = useState(initialTitle)
  const [isPending, startTransition] = useTransition()
  const inputRef                     = useRef<HTMLInputElement>(null)

  function startEdit() {
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function save() {
    const trimmed = value.trim()
    if (!trimmed) { setValue(initialTitle); setEditing(false); return }
    if (trimmed === initialTitle) { setEditing(false); return }
    startTransition(async () => {
      await updateTaskField(taskId, 'title', trimmed)
      setEditing(false)
    })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') { setValue(initialTitle); setEditing(false) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        disabled={isPending}
        className="w-full text-2xl font-bold tracking-tight text-foreground bg-transparent border-b-2 border-ring focus-visible:outline-none"
        autoFocus
      />
    )
  }

  return (
    <h1
      className="text-2xl font-bold tracking-tight text-foreground cursor-pointer hover:opacity-80 transition-opacity"
      onClick={startEdit}
      title="Click to edit"
    >
      {value}
    </h1>
  )
}
