'use client'

import { useState } from 'react'
import { NOT_RESOLVED_REASONS, REASON_LABEL, MAX_FSR_FILES, MAX_FSR_BYTES, MAX_PARTS, type NotResolvedReason } from '@/lib/visits/constants'

// The page an OEM engineer opens at a store. No account: the store code and the store's visit code of the day are the way in. Written to work on a phone.

type Issue = { unitId: string; ckdeskNo: string; details: string; tickets: { requestNo: string; title: string; loggedOn: string }[] }
type PartLine = { name: string; qty: string }
type Row = { picked: boolean; status: '' | 'resolved' | 'not_resolved'; reason: '' | NotResolvedReason; parts: PartLine[]; remarks: string }
type Done = { ckdeskNo: string; tickets: string[]; resolved: boolean }[]

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const fieldBase = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900'
const field = `w-full ${fieldBase}`
const label = 'block text-sm font-medium text-gray-700'

export function EngineerClient() {
  const [storeCode, setStoreCode] = useState('')
  const [code, setCode] = useState('')
  const [store, setStore] = useState<{ code: string; name: string } | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [visitDate, setVisitDate] = useState(today())
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const res = await fetch('/api/engineer/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeCode, code }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Something went wrong. Please try again.'); return }
      setStore(data.store); setIssues(data.issues)
      setRows(Object.fromEntries((data.issues as Issue[]).map((i) => [i.unitId, { picked: false, status: '', reason: '', parts: [{ name: '', qty: '1' }], remarks: '' } as Row])))
    } catch { setError('The page could not reach the server. Please check the network and try again.') } finally { setBusy(false) }
  }

  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))

  function addFiles(list: FileList | null) {
    if (!list) return
    const next = [...files, ...Array.from(list)].slice(0, MAX_FSR_FILES)
    const big = next.find((f) => f.size > MAX_FSR_BYTES)
    if (big) { setError(`"${big.name}" is larger than ${MAX_FSR_BYTES / 1024 / 1024} MB. Please send a smaller photo.`); return }
    setError(null); setFiles(next)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const chosen = issues.filter((i) => rows[i.unitId]?.picked)
    if (name.trim().length < 2) return setError('Please enter your name.')
    if (!/^[6-9]\d{9}$/.test(mobile.replace(/\s|-/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))) return setError('Please enter your 10-digit mobile number.')
    if (files.length === 0) return setError('Please attach a photo of the signed FSR.')
    if (chosen.length === 0) return setError('Tick the ACs you worked on.')
    for (const i of chosen) {
      const r = rows[i.unitId]
      if (!r.status) return setError(`AC ${i.ckdeskNo}: choose Resolved or Not resolved.`)
      if (r.status === 'not_resolved') {
        if (!r.reason) return setError(`AC ${i.ckdeskNo}: say why it is not resolved.`)
        if ((r.reason === 'parts_po' || r.reason === 'parts_oem') && !r.parts.some((p) => p.name.trim())) return setError(`AC ${i.ckdeskNo}: list the parts that are needed.`)
        if (r.reason === 'other' && r.remarks.trim().length < 3) return setError(`AC ${i.ckdeskNo}: please write the reason in the remarks.`)
      }
    }
    const items = chosen.map((i) => {
      const r = rows[i.unitId]
      return {
        unitId: i.unitId, status: r.status, reason: r.status === 'not_resolved' ? r.reason : null,
        parts: r.status === 'not_resolved' && (r.reason === 'parts_po' || r.reason === 'parts_oem') ? r.parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name, qty: Number(p.qty || 1) })) : [],
        remarks: r.remarks,
      }
    })
    const fd = new FormData()
    fd.set('storeCode', storeCode); fd.set('code', code); fd.set('name', name); fd.set('mobile', mobile); fd.set('visitDate', visitDate); fd.set('items', JSON.stringify(items))
    for (const f of files) fd.append('fsr', f)
    setBusy(true)
    try {
      const res = await fetch('/api/engineer/submit', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Something went wrong. Please try again.'); return }
      setDone(data.items as Done)
    } catch { setError('The report could not be sent. Please check the network and try again.') } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-gray-50 px-4 py-6 text-gray-900">
      <h1 className="text-xl font-semibold">OEM engineer visit report</h1>
      <p className="mt-1 text-sm text-gray-600">Citykart. Use this page after your visit to a store. No login is needed.</p>

      {done ? (
        <section className="mt-6 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" aria-live="polite">
          <h2 className="font-semibold text-emerald-900">Thank you. Your report has been recorded.</h2>
          <ul className="list-disc pl-5 text-sm text-emerald-900">
            {done.map((d) => <li key={d.ckdeskNo}>AC {d.ckdeskNo}: {d.resolved ? 'resolved' : 'not resolved'} (tickets {d.tickets.join(', ')})</li>)}
          </ul>
          <p className="text-sm text-emerald-900">The store will now check your report. You may close this page.</p>
        </section>
      ) : !store ? (
        <form onSubmit={lookup} className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">Step 1. Which store are you at?</h2>
          <div><label htmlFor="storeCode" className={label}>Store code</label>
            <input id="storeCode" value={storeCode} onChange={(e) => setStoreCode(e.target.value.toUpperCase())} className={field} autoCapitalize="characters" autoComplete="off" required /></div>
          <div><label htmlFor="visitCode" className={label}>Visit code (ask the store manager; it changes every day)</label>
            <input id="visitCode" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className={field} inputMode="numeric" autoComplete="off" required /></div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy || !storeCode || code.length !== 6} className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50">{busy ? 'Checking...' : 'Show the AC issues'}</button>
        </form>
      ) : issues.length === 0 ? (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <p>Store <b>{store.code}</b> ({store.name}) has no open AC issue to report on right now.</p>
          <button type="button" className="mt-3 text-blue-700 underline" onClick={() => { setStore(null); setCode('') }}>Use another store</button>
        </section>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="font-semibold">Store {store.code} - {store.name}</h2>
            <p className="text-sm text-gray-600">Step 2. Your details</p>
            <div className="mt-3 space-y-3">
              <div><label htmlFor="eng-name" className={label}>Your name</label><input id="eng-name" value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={80} autoComplete="off" /></div>
              <div><label htmlFor="eng-mobile" className={label}>Your mobile number</label><input id="eng-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} className={field} inputMode="tel" maxLength={14} autoComplete="off" /></div>
              <div><label htmlFor="eng-date" className={label}>Visit date</label><input id="eng-date" type="date" value={visitDate} max={today()} onChange={(e) => setVisitDate(e.target.value)} className={field} /></div>
              <div><label htmlFor="eng-fsr" className={label}>Photo of the signed FSR (up to {MAX_FSR_FILES}, JPG / PNG / PDF)</label>
                <input id="eng-fsr" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => addFiles(e.target.files)} className="block w-full text-sm" />
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {files.map((f, n) => <li key={`${f.name}-${n}`} className="flex items-center justify-between rounded bg-gray-100 px-2 py-1"><span className="truncate">{f.name}</span><button type="button" className="ml-2 text-red-700" onClick={() => setFiles(files.filter((_, k) => k !== n))}>Remove</button></li>)}
                  </ul>)}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-sm text-gray-600">Step 3. Tick each AC you worked on and say what happened.</p>
            {issues.map((i) => {
              const r = rows[i.unitId]
              return (
                <div key={i.unitId} className={`rounded-xl border bg-white p-4 ${r.picked ? 'border-blue-400' : 'border-gray-200'}`}>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1 h-5 w-5" checked={r.picked} onChange={(e) => setRow(i.unitId, { picked: e.target.checked })} />
                    <span><span className="font-semibold">AC {i.ckdeskNo}</span>{i.details && <span className="text-gray-600"> - {i.details}</span>}
                      <span className="mt-1 block text-xs text-gray-600">{i.tickets.map((t) => `${t.requestNo}: ${t.title} (logged ${t.loggedOn})`).join(' | ')}</span></span>
                  </label>
                  {r.picked && (
                    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                      <div className="flex gap-4 text-base" role="radiogroup" aria-label={`Result for AC ${i.ckdeskNo}`}>
                        <label className="flex items-center gap-1.5"><input type="radio" name={`s-${i.unitId}`} checked={r.status === 'resolved'} onChange={() => setRow(i.unitId, { status: 'resolved' })} /> Resolved</label>
                        <label className="flex items-center gap-1.5"><input type="radio" name={`s-${i.unitId}`} checked={r.status === 'not_resolved'} onChange={() => setRow(i.unitId, { status: 'not_resolved' })} /> Not resolved</label>
                      </div>
                      {r.status === 'not_resolved' && (
                        <>
                          <div><label htmlFor={`reason-${i.unitId}`} className={label}>Why is it not resolved?</label>
                            <select id={`reason-${i.unitId}`} value={r.reason} onChange={(e) => setRow(i.unitId, { reason: e.target.value as NotResolvedReason })} className={field}>
                              <option value="">Choose...</option>
                              {NOT_RESOLVED_REASONS.map((k) => <option key={k} value={k}>{REASON_LABEL[k].replace('Not resolved - ', '')}</option>)}
                            </select></div>
                          {(r.reason === 'parts_po' || r.reason === 'parts_oem') && (
                            <div className="space-y-2">
                              <p className={label}>Parts needed (name and quantity)</p>
                              {r.parts.map((p, n) => (
                                <div key={n} className="flex gap-2">
                                  <input aria-label={`Part ${n + 1} name`} value={p.name} onChange={(e) => setRow(i.unitId, { parts: r.parts.map((x, k) => (k === n ? { ...x, name: e.target.value } : x)) })} placeholder="Part name" className={`${fieldBase} min-w-0 flex-1`} maxLength={80} />
                                  <input aria-label={`Part ${n + 1} quantity`} value={p.qty} onChange={(e) => setRow(i.unitId, { parts: r.parts.map((x, k) => (k === n ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)) })} inputMode="numeric" className={`${fieldBase} w-20 shrink-0`} />
                                </div>
                              ))}
                              {r.parts.length < MAX_PARTS && <button type="button" className="text-sm text-blue-700 underline" onClick={() => setRow(i.unitId, { parts: [...r.parts, { name: '', qty: '1' }] })}>+ Add another part</button>}
                            </div>
                          )}
                        </>
                      )}
                      <div><label htmlFor={`rem-${i.unitId}`} className={label}>Remarks (optional)</label>
                        <textarea id={`rem-${i.unitId}`} value={r.remarks} onChange={(e) => setRow(i.unitId, { remarks: e.target.value })} rows={2} maxLength={500} className={field} /></div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-700 px-4 py-3 text-base font-medium text-white disabled:opacity-50">{busy ? 'Sending...' : 'Send my visit report'}</button>
        </form>
      )}
    </main>
  )
}
