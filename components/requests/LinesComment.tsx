import type { LinesCommentView } from '@/lib/vendor/lines-comment'

// A vendor's parts list or quote in the conversation, shown as a table (item and quantity; price without GST and line total when the vendor gave prices).
// Everything is rendered as text by React (nothing is inserted as HTML), so ticket text can never inject markup.
export function LinesComment({ view }: { view: LinesCommentView }) {
  return (
    <div className="mt-2 space-y-2 text-sm leading-relaxed text-foreground">
      {view.before && <p className="whitespace-pre-wrap break-words">{view.before}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60">
              <th scope="col" className="w-10 border border-border px-2.5 py-1.5 text-left font-semibold">#</th>
              <th scope="col" className="border border-border px-2.5 py-1.5 text-left font-semibold">Item</th>
              <th scope="col" className="border border-border px-2.5 py-1.5 text-right font-semibold">Qty</th>
              {view.hasPrice && <th scope="col" className="border border-border px-2.5 py-1.5 text-right font-semibold">Price (without GST)</th>}
              {view.hasPrice && <th scope="col" className="border border-border px-2.5 py-1.5 text-right font-semibold">Line total</th>}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.no}>
                <td className="border border-border px-2.5 py-1.5 align-top">{r.no}</td>
                <td className="break-words border border-border px-2.5 py-1.5 align-top">{r.item}</td>
                <td className="border border-border px-2.5 py-1.5 text-right align-top">{r.qty}</td>
                {view.hasPrice && <td className="border border-border px-2.5 py-1.5 text-right align-top">{r.price}</td>}
                {view.hasPrice && <td className="border border-border px-2.5 py-1.5 text-right align-top">{r.total}</td>}
              </tr>
            ))}
          </tbody>
          {view.hasPrice && view.total && (
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td colSpan={4} className="border border-border px-2.5 py-1.5 text-right">Total (without GST)</td>
                <td className="border border-border px-2.5 py-1.5 text-right">{view.total}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {view.after && <p className="whitespace-pre-wrap break-words">{view.after}</p>}
    </div>
  )
}
