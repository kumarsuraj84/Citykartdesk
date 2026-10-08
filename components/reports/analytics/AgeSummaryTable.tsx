import type { AgeSummary, DayCounts } from '@/lib/reporting/analytics/age-summary'

// On-screen version of the pivot: Responsible | Category | Sub Category | <age buckets…> | Grand Total |
// Created / Resolved / Closed on the reference day, with a "<Technician> Total" row after each technician
// and a Grand Total row at the end.
export function AgeSummaryTable({ summary, dayWord }: { summary: AgeSummary; dayWord: string }) {
  const { buckets, technicians, grand } = summary
  const num = 'px-3 py-2 text-right text-[12px] tabular-nums'
  const show = (n: number | undefined) => (n ? n : '')
  const dayHead = [`Created ${dayWord}`, `Resolved ${dayWord}`, `Closed ${dayWord}`]
  const dayCells = (d: DayCounts, cls = num) => (
    <>
      <td className={`${cls} border-l border-border/60`}>{show(d.created)}</td>
      <td className={cls}>{show(d.resolved)}</td>
      <td className={cls}>{show(d.closed)}</td>
    </>
  )

  if (technicians.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">Try a wider date range, include more statuses or services.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Responsible</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Category</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">Sub Category</th>
            {buckets.map((b) => (
              <th key={b} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap">{b}</th>
            ))}
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap">Grand Total</th>
            {dayHead.map((h, i) => (
              <th key={h} className={`px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap bg-primary/80 ${i === 0 ? 'border-l border-primary-foreground/30' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {technicians.map((t) => (
            <TechnicianRows key={t.name} tech={t} buckets={buckets} num={num} show={show} dayCells={dayCells} />
          ))}
          <tr className="border-t-2 border-primary/40 bg-primary/10 font-bold">
            <td className="px-3 py-2 text-[12px]" colSpan={3}>Grand Total</td>
            {buckets.map((b) => <td key={b} className={num}>{show(grand.counts[b])}</td>)}
            <td className={num}>{grand.total}</td>
            {dayCells(grand.day)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function TechnicianRows({ tech, buckets, num, show, dayCells }: {
  tech: AgeSummary['technicians'][number]
  buckets: string[]
  num: string
  show: (n: number | undefined) => number | string
  dayCells: (d: DayCounts, cls?: string) => React.ReactNode
}) {
  let first = true
  return (
    <>
      {tech.categories.flatMap((c) =>
        c.subCategories.map((s, si) => {
          const isFirst = first
          first = false
          return (
            <tr key={`${c.name}|${s.name}`} className="border-t border-border/60 hover:bg-muted/30">
              <td className="px-3 py-2 text-[12px] font-semibold text-foreground">{isFirst ? tech.name : ''}</td>
              <td className="px-3 py-2 text-[12px] text-foreground">{si === 0 ? c.name : ''}</td>
              <td className="px-3 py-2 text-[12px] text-muted-foreground">{s.name}</td>
              {buckets.map((b) => <td key={b} className={num}>{show(s.counts[b])}</td>)}
              <td className={`${num} font-semibold`}>{s.total || ''}</td>
              {dayCells(s.day)}
            </tr>
          )
        })
      )}
      <tr className="border-t border-border bg-muted/50 font-semibold">
        <td className="px-3 py-2 text-[12px]" colSpan={3}>{tech.name} Total</td>
        {buckets.map((b) => <td key={b} className={num}>{show(tech.counts[b])}</td>)}
        <td className={num}>{tech.total}</td>
        {dayCells(tech.day)}
      </tr>
    </>
  )
}
