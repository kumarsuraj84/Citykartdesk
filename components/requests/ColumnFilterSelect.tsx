'use client'

import { useRouter } from 'next/navigation'

interface ColumnFilterSelectProps {
  paramName: string
  value: string
  options: { value: string; label: string }[]
  placeholder: string
  pathname: string
  /** Current URL's query string (searchParams.toString(), no leading '?') — a Server
   *  Component can't pass a closure to a Client Component, so this builds hrefs by
   *  adding/removing exactly this one param, locally, from a plain string. */
  currentSearch: string
  className?: string
}

/** Generic "column filter" dropdown for the requests table — one instance per
 *  filterable column (Priority, Service, Assignee, …). Navigating via a URL param
 *  keeps every filter shareable/bookmarkable and composes with the existing
 *  status pills and search box, which already work the same way. */
export function ColumnFilterSelect({ paramName, value, options, placeholder, pathname, currentSearch, className }: ColumnFilterSelectProps) {
  const router = useRouter()

  function handleChange(next: string) {
    const params = new URLSearchParams(currentSearch)
    if (next) params.set(paramName, next)
    else params.delete(paramName)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className={className ?? 'rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring'}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
