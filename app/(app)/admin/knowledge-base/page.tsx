import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/PageHeader'
import { KnowledgeBaseClient } from './KnowledgeBaseClient'

export const dynamic = 'force-dynamic'

export default async function KnowledgeBasePage() {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: articles } = await (supabase as any)
    .from('kb_articles')
    .select('id, title, slug, status, view_count, helpful_yes, helpful_no, created_at, updated_at, author:profiles(id, full_name)')
    .order('updated_at', { ascending: false })

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Knowledge Base"
        description="Create and manage articles to help users self-serve."
      />
      <KnowledgeBaseClient articles={articles ?? []} />
    </div>
  )
}
