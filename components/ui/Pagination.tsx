'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  pageSize: number
  basePath: string
  currentParams?: Record<string, string>
}

const PAGE_SIZE_OPTIONS = [25, 50, 100]

export function Pagination({
  page: rawPage,
  totalPages: rawTotalPages,
  total: rawTotal,
  pageSize: rawPageSize,
  basePath,
  currentParams = {},
}: PaginationProps) {
  const page       = Number.isFinite(rawPage)       ? rawPage       : 1
  const totalPages = Number.isFinite(rawTotalPages) ? rawTotalPages : 1
  const total      = Number.isFinite(rawTotal)      ? rawTotal      : 0
  const pageSize   = PAGE_SIZE_OPTIONS.includes(rawPageSize) ? rawPageSize : 50
  const router = useRouter()
  const searchParams = useSearchParams()

  function buildUrl(newPage: number, newSize?: number) {
    const params = new URLSearchParams(searchParams.toString())
    // Apply any overrides from currentParams
    for (const [k, v] of Object.entries(currentParams)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    params.set('page', String(newPage))
    params.set('pageSize', String(newSize ?? pageSize))
    return `${basePath}?${params.toString()}`
  }

  function navigate(newPage: number, newSize?: number) {
    router.push(buildUrl(newPage, newSize))
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  if (total === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-muted-foreground">
      {/* Count summary */}
      <span className="text-xs">
        Showing{' '}
        <span className="font-semibold text-foreground">
          {from}–{to}
        </span>{' '}
        of{' '}
        <span className="font-semibold text-foreground">{total}</span> results
      </span>

      <div className="flex items-center gap-3">
        {/* Page size selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="page-size-select" className="text-xs">
            Per page:
          </label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => navigate(1, Number(e.target.value))}
            className="rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* Prev / page indicator / Next */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="px-2 text-xs font-medium">
            Page{' '}
            <span className="font-semibold text-foreground">{page}</span>
            {' '}of{' '}
            <span className="font-semibold text-foreground">{totalPages}</span>
          </span>

          <button
            onClick={() => navigate(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
