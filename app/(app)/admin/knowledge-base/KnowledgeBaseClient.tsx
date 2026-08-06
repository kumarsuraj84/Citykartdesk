'use client'

import { useState, useTransition } from 'react'
import { BookOpen, Plus, Eye, ThumbsUp, ThumbsDown, Pencil, Archive, CheckCircle } from 'lucide-react'
import { createKbArticle, updateKbArticle, archiveKbArticle } from '@/lib/actions/knowledge-base'

type ArticleStatus = 'draft' | 'published' | 'archived'

interface Article {
  id: string
  title: string
  slug: string
  status: ArticleStatus
  view_count: number
  helpful_yes: number
  helpful_no: number
  created_at: string
  updated_at: string
  author: { id: string; full_name: string } | null
}

interface KnowledgeBaseClientProps {
  articles: Article[]
}

const STATUS_STYLES: Record<ArticleStatus, string> = {
  draft:     'bg-muted text-muted-foreground',
  published: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  archived:  'bg-red-50 text-red-600 border border-red-200',
}

export function KnowledgeBaseClient({ articles: initial }: KnowledgeBaseClientProps) {
  const [articles, setArticles] = useState(initial)
  const [editing, setEditing]   = useState<string | null>(null)  // article id or 'new'
  const [form, setForm]         = useState({ title: '', content: '', status: 'draft' as ArticleStatus })
  const [error, setError]       = useState<string | null>(null)
  const [isPending, start]      = useTransition()

  function openNew() {
    setForm({ title: '', content: '', status: 'draft' })
    setEditing('new')
    setError(null)
  }

  function openEdit(a: Article) {
    setForm({ title: a.title, content: '', status: a.status })
    setEditing(a.id)
    setError(null)
  }

  function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    setError(null)
    start(async () => {
      if (editing === 'new') {
        const res = await createKbArticle(form.title, form.content, form.status)
        if (res?.error) { setError(res.error); return }
        if (res?.article) setArticles((prev) => [res.article as Article, ...prev])
      } else if (editing) {
        const res = await updateKbArticle(editing, form.title, form.content, form.status)
        if (res?.error) { setError(res.error); return }
        setArticles((prev) => prev.map((a) => a.id === editing
          ? { ...a, title: form.title, status: form.status, updated_at: new Date().toISOString() }
          : a
        ))
      }
      setEditing(null)
    })
  }

  function handleArchive(id: string) {
    start(async () => {
      const res = await archiveKbArticle(id)
      if (res?.error) return
      setArticles((prev) => prev.map((a) => a.id === id ? { ...a, status: 'archived' } : a))
    })
  }

  if (editing !== null) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h2 className="text-sm font-semibold">{editing === 'new' ? 'New Article' : 'Edit Article'}</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Article title…"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Content (Markdown)</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Write article content in Markdown…"
              rows={12}
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ArticleStatus }))}
              className="mt-1 h-9 w-40 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="btn-gradient"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="btn-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openNew}
          className="btn-gradient"
        >
          <Plus className="h-3.5 w-3.5" /> New Article
        </button>
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No articles yet</p>
          <p className="text-xs text-muted-foreground/70">Create your first article to help users self-serve.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Title</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Views</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Helpful</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Author</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Updated</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {articles.map((a) => (
                <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium text-ink text-sm">{a.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_STYLES[a.status]}`}>
                      {a.status === 'published' && <CheckCircle className="h-2.5 w-2.5" />}
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <Eye className="h-3 w-3" /> {a.view_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5 text-emerald-600"><ThumbsUp className="h-3 w-3" />{a.helpful_yes}</span>
                      <span className="flex items-center gap-0.5 text-red-500"><ThumbsDown className="h-3 w-3" />{a.helpful_no}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{a.author?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(a.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => openEdit(a)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {a.status !== 'archived' && (
                        <button onClick={() => handleArchive(a.id)} disabled={isPending} className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50" title="Archive">
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
