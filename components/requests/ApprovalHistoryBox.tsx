import { shortDate, type ApprovalHistory } from '@/lib/approvals/history-model'

const OUTCOME_LABEL = { approved: 'Approved', rejected: 'Rejected', waiting: 'Waiting for a decision' } as const
const OUTCOME_CLASS = { approved: 'text-emerald-700', rejected: 'text-red-700', waiting: 'text-amber-700' } as const

/** "Asking now" and the last decisions on requests of the same store and sub-category, shown beside the Approve / Reject buttons. */
export function ApprovalHistoryBox({ history: h }: { history: ApprovalHistory }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
      <div>
        <p className="font-semibold">Asking now</p>
        <p className="mt-0.5">
          {h.storeName && <>{h.storeName}: </>}{h.category}
          {h.columns.map((c, i) => <span key={c}>{i === 0 ? ' - ' : ', '}{c} <strong>{h.now[i] ?? '-'}</strong></span>)}
        </p>
      </div>
      <div>
        <p className="font-semibold">Earlier requests of this store, same sub-category (last {h.months} months)</p>
        {h.earlier.length === 0 ? (
          <p className="mt-0.5 text-muted-foreground">No earlier request of this store for this sub-category.</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Date</th>
                  <th className="py-1 pr-3 font-medium">Request</th>
                  {h.columns.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}
                  <th className="py-1 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody>
                {h.earlier.map((r) => (
                  <tr key={`${r.requestNo}-${r.at}`} className="border-b border-border/50 align-top">
                    <td className="py-1 pr-3 whitespace-nowrap">{shortDate(r.at)}</td>
                    <td className="py-1 pr-3 whitespace-nowrap font-mono">{r.requestNo}</td>
                    {r.values.map((v, i) => <td key={i} className="py-1 pr-3">{v}</td>)}
                    <td className={`py-1 ${OUTCOME_CLASS[r.outcome]}`}>
                      {OUTCOME_LABEL[r.outcome]}{r.outcome !== 'waiting' && r.decidedBy ? ` by ${r.decidedBy}` : ''}
                      {r.outcome === 'rejected' && r.comment ? <span className="text-muted-foreground"> ({r.comment.length > 120 ? `${r.comment.slice(0, 120)}...` : r.comment})</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {h.totals.length > 0 && <p className="mt-1.5">Approved in these {h.months} months: <strong>{h.totals.map((t) => `${t.label} ${t.total}`).join(', ')}</strong></p>}
        {h.moreCount > 0 && <p className="mt-1 text-muted-foreground">{h.moreCount} more earlier request{h.moreCount === 1 ? '' : 's'} not listed.</p>}
      </div>
    </div>
  )
}
