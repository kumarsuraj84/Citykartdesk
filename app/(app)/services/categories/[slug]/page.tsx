import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, ChevronLeft, LayoutGrid } from 'lucide-react'
import { getCategoryBySlug } from '@/lib/queries/services'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ServiceWithRelations, ServiceSubCategoryWithServices } from '@/types'

interface PageProps {
  params: Promise<{ slug: string }>
}

function ServiceCard({ service }: { service: ServiceWithRelations }) {
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
        {service.icon ?? '📋'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
          {service.name}
        </p>
        {service.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{service.description}</p>
        )}
        <p className="mt-1.5 text-[10px] text-muted-foreground">{service.team.name}</p>
      </div>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  )
}

function SubCategorySection({
  subCategory,
  categorySlug,
}: {
  subCategory: ServiceSubCategoryWithServices
  categorySlug: string
}) {
  if (subCategory.services.length === 0) return null

  return (
    <section>
      {/* Sub-category header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {subCategory.icon && (
            <span className="text-lg">{subCategory.icon}</span>
          )}
          <div>
            <h2 className="text-sm font-semibold text-foreground">{subCategory.name}</h2>
            {subCategory.description && (
              <p className="text-xs text-muted-foreground">{subCategory.description}</p>
            )}
          </div>
        </div>
        <Link
          href={`/services/categories/${categorySlug}/${subCategory.slug}`}
          className="shrink-0 text-xs text-primary hover:underline"
        >
          View all ({subCategory.services.length})
        </Link>
      </div>

      {/* Services (show first 3; link to sub-cat page for more) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {subCategory.services.slice(0, 3).map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>
    </section>
  )
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  if (!category) notFound()

  const totalServices = category.sub_categories.reduce(
    (acc, sc) => acc + sc.services.length,
    0
  )

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href="/services"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Service Catalog
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground">{category.name}</span>
      </nav>

      {/* Category hero */}
      <div className="flex items-start gap-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-3xl">
          {category.icon ?? '📋'}
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{category.name}</h1>
          {category.description && (
            <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {totalServices} service{totalServices !== 1 ? 's' : ''}
            {' · '}
            {category.sub_categories.length} sub-categor{category.sub_categories.length !== 1 ? 'ies' : 'y'}
          </p>
        </div>
      </div>

      {/* Sub-category quick-nav chips */}
      {category.sub_categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {category.sub_categories.map((sc) => (
            <Link
              key={sc.id}
              href={`/services/categories/${slug}/${sc.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              {sc.icon && <span className="text-[11px]">{sc.icon}</span>}
              {sc.name}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                {sc.services.length}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Sub-category sections */}
      {category.sub_categories.length > 0 ? (
        <div className="space-y-8">
          {category.sub_categories.map((sc) => (
            <SubCategorySection
              key={sc.id}
              subCategory={sc}
              categorySlug={slug}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={LayoutGrid}
            title="No services yet"
            description="No services have been added to this category yet."
          />
        </div>
      )}
    </div>
  )
}
