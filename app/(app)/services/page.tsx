import Link from 'next/link'
import { Search } from 'lucide-react'
import { getServices, searchServices } from '@/lib/queries/services'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { CategoryIcon } from '@/components/admin/CategoryIcon'
import type { ServiceWithRelations } from '@/types'

interface PageProps {
  searchParams: Promise<{ q?: string }>
}

// ── Service card ────────────────────────────────────────────────────────────
// Service Catalog is a flat list now — a broad service (e.g. "IT") no longer
// has one fixed category to browse through; category is a field the requester
// picks inside the submission form itself.

function ServiceCard({ service }: { service: ServiceWithRelations }) {
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-all hover:border-primary/20 hover:shadow-sm"
    >
      <CategoryIcon
        icon={service.icon}
        iconImageUrl={service.icon_image_url}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-sm"
      />
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

// ── Search results ────────────────────────────────────────────────────────────

async function SearchResults({ query }: { query: string }) {
  const results = await searchServices(query)

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <EmptyState
          icon={Search}
          title={`No results for "${query}"`}
          description="Try a different search term."
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
  const services = await getServices()

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
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Search}
            title="No services yet"
            description="An admin needs to add services to the catalog first."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  )
}
