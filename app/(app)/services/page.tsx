import Link from 'next/link'
import { Search, ChevronRight } from 'lucide-react'
import { getCategoriesWithSubCategories, searchServices } from '@/lib/queries/services'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ServiceCategoryWithSubCategories, ServiceWithRelations } from '@/types'

interface PageProps {
  searchParams: Promise<{ q?: string }>
}

// ── Service card (compact, used in search results) ────────────────────────────

function ServiceCard({ service }: { service: ServiceWithRelations }) {
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-all hover:border-primary/20 hover:shadow-sm"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-sm">
        {service.icon ?? '📋'}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-foreground transition-colors group-hover:text-primary">
          {service.name}
        </p>
        {service.description && (
          <p className="line-clamp-1 text-[10px] text-muted-foreground">{service.description}</p>
        )}
      </div>
    </Link>
  )
}

// ── Category card ─────────────────────────────────────────────────────────────

function CategoryCard({ cat }: { cat: ServiceCategoryWithSubCategories }) {
  const totalServices = cat.sub_categories.reduce(
    (acc, sc) => acc + sc.services.length,
    0
  )

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card transition-all hover:shadow-sm">
      {/* Header */}
      <Link
        href={`/services/categories/${cat.slug}`}
        className="group flex items-start gap-3 rounded-t-lg px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
          {cat.icon ?? '📋'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-foreground transition-colors group-hover:text-primary">
              {cat.name}
            </h2>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          {cat.description && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{cat.description}</p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">
            {totalServices} service{totalServices !== 1 ? 's' : ''}
          </p>
        </div>
      </Link>

      {/* Sub-category chips */}
      {cat.sub_categories.length > 0 && (
        <div className="border-t border-border/60 px-4 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            {cat.sub_categories.map((sc) => (
              <Link
                key={sc.id}
                href={`/services/categories/${cat.slug}/${sc.slug}`}
                className="group/chip inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground/70 transition-colors hover:border-primary/20 hover:bg-muted hover:text-foreground"
              >
                {sc.icon && <span className="text-[10px]">{sc.icon}</span>}
                {sc.name}
                <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground group-hover/chip:bg-primary/10 group-hover/chip:text-primary">
                  {sc.services.length}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Search results ────────────────────────────────────────────────────────────

async function SearchResults({ query }: { query: string }) {
  const results = await searchServices(query)

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <EmptyState
          icon={Search}
          title={`No results for "${query}"`}
          description="Try a different search term or browse by category."
        />
      </div>
    )
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((s) => (
          <ServiceCard key={s.id} service={s} />
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ServicesPage({ searchParams }: PageProps) {
  const { q } = await searchParams
  const isSearching = Boolean(q?.trim())
  const categories = await getCategoriesWithSubCategories()

  return (
    <div className="space-y-3">
      <PageHeader
        title="Service Catalog"
        description="Browse and request services from your teams"
      />

      <form className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search services…"
          className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </form>

      {isSearching ? (
        <SearchResults query={q!} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {categories.map((cat) => (
            <CategoryCard key={cat.id} cat={cat} />
          ))}
        </div>
      )}
    </div>
  )
}
