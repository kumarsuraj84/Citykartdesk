import type { OemCommentView } from '@/lib/masters/comment-view'

// The conversation note "Ticket sent to the AC / Genset OEM": who it went to, and the mail's table shown as a table (the same look as the mail itself).
// Everything is rendered as text by React (nothing is inserted as HTML), so ticket text can never inject markup.
export function OemSentComment({ view }: { view: OemCommentView }) {
  return (
    <div className="mt-2 space-y-2 text-sm leading-relaxed text-foreground">
      <p className="font-medium">{view.heading}</p>
      {view.meta.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {view.meta.map((m, i) => (
            <div key={i} className="contents">
              <dt className="font-semibold text-muted-foreground">{m.label}</dt>
              <dd className="min-w-0 break-words">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.blocks.map((b, i) =>
        b.kind === 'text' ? (
          <p key={i} className="whitespace-pre-wrap break-words">{b.text}</p>
        ) : (
          <div key={i} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    <th scope="row" className="w-[30%] border border-border bg-muted/60 px-2.5 py-1.5 text-left align-top font-semibold">{r.label}</th>
                    <td className="whitespace-pre-wrap break-words border border-border px-2.5 py-1.5 align-top">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  )
}
