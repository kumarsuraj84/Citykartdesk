'use client'

import { useRouter } from 'next/navigation'

interface StatusFilterSelectProps {
  value: string
  options: { value: string; label: string }[]
  pathname: string
  /** Current URL's query string (searchParams.toString(), no leading '?') — mirrors
   *  ColumnFilterSelect's approach so a Server Component can pass a plain string
   *  instead of a closure across the client boundary. */
  currentSearch: string
}

/** Status filter as a compact dropdown instead of a row of pill buttons — every
 *  state (including "Active" and "All") is always written to the URL explicitly,
 *  so there's no ambiguous "absent param" state to fall back on incorrectly. */
export function StatusFilterSelect({ value, options, pathname, currentSearch }: StatusFilterSelectProps) {
  const router = useRouter()

  function handleChange(next: string) {
    const params = new URLSearchParams(currentSearch)
    params.set('status', next)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
