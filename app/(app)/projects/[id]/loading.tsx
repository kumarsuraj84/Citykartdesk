export default function ProjectDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Back link */}
      <div className="h-4 w-28 rounded bg-muted" />

      {/* Header card */}
      <div className="rounded-lg border border-border bg-card p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-5 w-64 rounded bg-muted" />
            <div className="h-3 w-96 rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-24 rounded-full bg-muted" />
            <div className="h-8 w-8 rounded-lg bg-muted" />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-3 w-24 rounded bg-muted" />
          ))}
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted" />
      </div>

      {/* Enhancements/milestones table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-3 py-2">
          {[140, 80, 64, 80, 80, 80, 64].map((w, i) => (
            <div key={i} className="h-3 rounded bg-muted" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-3 py-2.5 last:border-0">
            <div className="h-3.5 flex-1 max-w-[180px] rounded bg-muted" />
            <div className="h-5 w-16 rounded-full bg-muted" />
            <div className="h-5 w-12 rounded-full bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-2 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>

      {/* View-switcher tabs + task table */}
      <div className="flex gap-1.5">
        {[64, 64, 72].map((w, i) => (
          <div key={i} className="h-7 rounded-lg bg-muted" style={{ width: w }} />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
            <div className="h-4 w-4 rounded bg-muted shrink-0" />
            <div className="h-3.5 flex-1 rounded bg-muted" style={{ width: `${40 + (i % 4) * 12}%` }} />
            <div className="h-5 w-16 rounded-full bg-muted shrink-0" />
            <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
