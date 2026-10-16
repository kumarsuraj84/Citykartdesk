'use client'

import { useState, useTransition } from 'react'
import { setPolicy } from '@/lib/actions/admin/policies'
import { POLICY_LABELS, type PolicyKey, type PolicyValues } from '@/lib/permissions/matrix'

/** "Who may change what": the permission-matrix switches. Shown to platform owners only; each change is written to the audit trail. */
export function PolicySwitchesCard({ values }: { values: PolicyValues }) {
  const [current, setCurrent] = useState<PolicyValues>(values)
  const [message, setMessage] = useState<{ key: string; text: string; ok: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  function change(key: PolicyKey, value: string) {
    const previous = current[key]
    setCurrent((c) => ({ ...c, [key]: value }) as PolicyValues)
    startTransition(async () => {
      const r = await setPolicy(key, value)
      if (r.error) {
        setCurrent((c) => ({ ...c, [key]: previous }) as PolicyValues)
        setMessage({ key, text: r.error, ok: false })
      } else {
        setMessage({ key, text: 'Saved.', ok: true })
      }
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm divide-y divide-border">
      <div className="px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">Who may change what</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Only platform owners see this. The first choice of each item is how the system has always worked. Every change is written to the audit trail.
        </p>
      </div>
      {(Object.keys(POLICY_LABELS) as PolicyKey[]).map((key) => {
        const label = POLICY_LABELS[key]
        return (
          <div key={key} className="px-4 py-3 space-y-1.5">
            <p className="text-[12px] font-medium text-foreground">{label.title}</p>
            <p className="text-[11px] text-muted-foreground">{label.help}</p>
            <select
              value={current[key]}
              disabled={pending}
              onChange={(e) => change(key, e.target.value)}
              aria-label={label.title}
              className="mt-1 w-full max-w-md rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px]"
            >
              {Object.entries(label.options).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </select>
            {message?.key === key && (
              <p className={`text-[11px] ${message.ok ? 'text-emerald-600' : 'text-red-600'}`}>{message.text}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
