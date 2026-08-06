import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'
import { getSubCategoryBySlug } from '@/lib/queries/services'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ServiceWithRelations } from '@/types'

interface PageProps {
  params: Promise<{ slug: string; subSlug: string }>
}

function ServiceCard({ service }: { service: ServiceWithRelations }) {
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl">
          {service.icon ?? '📋'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {service.name}
          </p>
          <p className="text-xs text-muted-foreground">{service.team.name}</p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      {service.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{service.description}</p>
      )}
    </Link>
  )
}

export default async function SubCategoryPage({ params }: PageProps) {
  const { slug, subSlug } = await params
  const result = await getSubCategoryBySlug(slug, subSlug)
  if (!result) notFound()

  const { category, subCategory } = result

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href="/services"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Service Catalog
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <Link
          href={`/services/categories/${slug}`}
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          {category.name}
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground">{subCategory.name}</span>
      </nav>

      {/* Sub-category hero */}
      <div className="flex items-start gap-4 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
        {subCategory.icon && (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl">
            {subCategory.icon}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              href={`/services/categories/${slug}`}
              className="hover:text-foreground transition-colors"
            >
              {category.name}
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>{subCategory.name}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            {subCategory.name}
          </h1>
          {subCategory.description && (
            <p className="mt-1 text-sm text-muted-foreground">{subCategory.description}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {subCategory.services.length} service{subCategory.services.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Services */}
      {subCategory.services.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subCategory.services.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={LayoutGrid}
            title="No services yet"
            description="No services have been added to this sub-category yet."
            action={
              <Link
                href={`/services/categories/${slug}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to {category.name}
              </Link>
            }
          />
        </div>
      )}
    </div>
  )
}
