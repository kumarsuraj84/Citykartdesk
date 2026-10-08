import { CheckCircle2, Clock, Link2Off, RotateCcw } from 'lucide-react'
import { loadCsatPage } from '@/lib/csat/public'
import { CsatPublicForm } from './CsatPublicForm'

export const metadata = { title: 'Rate your request', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <p className="text-center text-sm font-semibold tracking-tight text-muted-foreground">Citykart Desk</p>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">{children}</div>
      </div>
    </div>
  )
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="space-y-2 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">{icon}</div>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

export default async function CsatPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { token } = await params
  const sp = await searchParams
  const state = await loadCsatPage(token)

  if (state.kind === 'invalid') {
    return <Shell><Notice icon={<Link2Off className="h-6 w-6 text-muted-foreground" />} title="This link is not valid" body="Please use the buttons in the latest e-mail we sent you, or open the request in Citykart Desk." /></Shell>
  }
  if (state.kind === 'expired') {
    return <Shell><Notice icon={<Clock className="h-6 w-6 text-muted-foreground" />} title="This link has expired" body="You can still open the request in Citykart Desk to see what happened." /></Shell>
  }
  if (state.reopened) {
    return <Shell><Notice icon={<RotateCcw className="h-6 w-6 text-muted-foreground" />} title={`${state.requestNo} is being worked on again`} body="This request was reopened, so there is nothing to rate right now. We will ask again once it is resolved." /></Shell>
  }

  const preset = Number.parseInt(sp.r ?? '', 10)
  const startRating = preset >= 1 && preset <= 5 ? preset : 0
  const wantsReopen = sp.reopen === '1'

  if (state.rated && !state.canReopen) {
    return <Shell><Notice icon={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} title="Thank you for your feedback" body={`Your rating for ${state.requestNo} has been recorded.`} /></Shell>
  }

  return (
    <Shell>
      <div className="space-y-1">
        <p className="font-mono text-xs text-muted-foreground">{state.requestNo}</p>
        <h1 className="text-lg font-semibold tracking-tight">{state.title}</h1>
      </div>
      <CsatPublicForm
        token={token}
        startRating={startRating}
        startReopen={wantsReopen && state.canReopen}
        rated={state.rated}
        ratedValue={state.rating}
        canReopen={state.canReopen}
        reopenUntilIso={state.reopenUntilIso}
        reopenEnded={state.reopenEnded}
      />
    </Shell>
  )
}
