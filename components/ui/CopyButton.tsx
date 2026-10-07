'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

/**
 * A small "copy this value" button for rows of read-only information. It sits in a row that has the
 * `group` class and shows on row hover / keyboard focus (always visible on touch screens).
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  if (!value || value === '—') return null

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (await copyText(value)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}
