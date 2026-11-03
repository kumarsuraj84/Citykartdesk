import { notFound } from 'next/navigation'
import { assistantAccess } from '@/lib/ckoneai/access'
import { ASSISTANT_NOTICE } from '@/lib/ckoneai/notice'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ask CK Desk' }

// The assistant's chat page (served by CKOneAI, through this server at /ckoneai-ui) shown inside CK Desk. A person who may not use it sees the same
// "page not found" as a made-up address, so the page does not announce itself.
// The height is the screen minus the top bar (4rem), the phone's bottom bar (about 4.1rem, phones only) and the page's own spacing, so the frame never adds a second scroll bar.
export default async function AskCkDeskPage() {
  const access = await assistantAccess()
  if (!access.ok) notFound()
  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-[24rem] flex-col gap-1.5 lg:h-[calc(100dvh-7.5rem)]">
      <p className="px-1 text-xs text-muted-foreground">{ASSISTANT_NOTICE}</p>
      <iframe
        title="Ask CK Desk"
        src="/ckoneai-ui?embed=1&bridge=ckdesk"
        className="min-h-0 w-full flex-1 rounded-xl border border-black/10 bg-white"
        allow="clipboard-write"
      />
    </div>
  )
}
