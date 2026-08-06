'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Loader2, Inbox as InboxIcon } from 'lucide-react'
import type { InboxMessage, IntakeChannel } from '@/lib/queries/intake'
import { loadReviewDetail, type ReviewDetailBundle } from '@/lib/actions/intake/detail'
import { InboxList } from './InboxList'
import { ReviewClient } from '../review/[id]/ReviewClient'
import { PipelineStatusBanner } from '@/components/intake/PipelineStatusBanner'

// 3-column intake workspace (mail-client style): the message list stays on the
// LEFT while a selected message opens in the center, with its classification /
// AI rail on the right (ReviewClient is itself two columns → columns 2 + 3).
// Each column scrolls independently. On small screens it collapses to a single
// pane: the list, or — once a message is open — the reading view with a Back
// button. Selection loads the review detail inline via a server action.
export function InboxWorkspace({
  messages, channels, initialFolder, initialChannel, profileId,
}: {
  messages: InboxMessage[]
  channels: IntakeChannel[]
  initialFolder?: string
  initialChannel?: string
  profileId: string
}) {
  const router = useRouter()
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewDetailBundle | null>(null)
  const [loading, startTransition] = useTransition()

  function open(reviewId: string | null, messageId: string) {
    // Not-yet-classified mail has no review to load inline. Open the full-page
    // reader (WorkspaceClient), which renders the raw email + convert tools, so
    // the message is always openable — even before the pipeline has run.
    if (!reviewId) {
      router.push(`/intake/inbox/${messageId}`)
      return
    }
    setActiveMessageId(messageId)
    startTransition(async () => {
      const bundle = await loadReviewDetail(reviewId)
      setDetail(bundle)
    })
  }

  function close() {
    setActiveMessageId(null)
    setDetail(null)
  }

  const hasOpen = activeMessageId !== null

  return (
    <div className="flex flex-col gap-2 lg:h-[calc(100vh-6rem)] lg:flex-row lg:gap-3 lg:overflow-hidden">
      {/* ── Column 1: message list ── */}
      <div className={`flex min-h-0 flex-col gap-2 lg:w-[340px] lg:shrink-0 ${hasOpen ? 'hidden lg:flex' : 'flex'}`}>
        <div className="space-y-0.5">
          <nav className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
            <Link href="/intake" className="transition-colors hover:text-foreground">Intake</Link>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="font-medium text-foreground">Inbox</span>
          </nav>
          <h1 className="text-lg font-bold leading-snug tracking-tight text-foreground">Inbox</h1>
        </div>
        <PipelineStatusBanner />
        <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
          <InboxList
            messages={messages}
            channels={channels}
            initialFolder={initialFolder}
            initialChannel={initialChannel}
            onOpen={open}
            activeMessageId={activeMessageId}
          />
        </div>
      </div>

      {/* ── Columns 2+3: reading pane + AI rail (ReviewClient) ── */}
      <div className={`min-w-0 flex-1 lg:overflow-y-auto ${hasOpen ? 'flex flex-col' : 'hidden lg:flex lg:flex-col'}`}>
        {hasOpen && (
          <button
            onClick={close}
            className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <ChevronLeft className="h-4 w-4" /> Back to inbox
          </button>
        )}

        {!hasOpen ? (
          <div className="flex h-full min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
            <InboxIcon className="h-8 w-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-semibold text-foreground">Select a message</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Pick a message from the list to read it and review its classification here.
            </p>
          </div>
        ) : loading ? (
          <div className="flex h-[60vh] items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <ReviewClient
            key={detail.review.id}
            review={detail.review}
            attachments={detail.attachments}
            thread={detail.thread}
            services={detail.services}
            teams={detail.teams}
            profileId={profileId}
          />
        ) : (
          // detail failed to load (classification pending or review not yet created).
          // Fall back to the full-page reader so the email is always readable.
          (() => {
            if (activeMessageId) router.push(`/intake/inbox/${activeMessageId}`)
            return (
              <div className="flex h-[60vh] items-center justify-center rounded-xl border border-border bg-card">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )
          })()
        )}
      </div>
    </div>
  )
}
