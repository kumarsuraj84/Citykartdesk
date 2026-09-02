import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getCategoryBySlug } from '@/lib/queries/services'
import { SubCategoryManager } from '@/components/admin/SubCategoryManager'
import { CategoryIcon } from '@/components/admin/CategoryIcon'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function AdminCategorySlugPage({ params }: PageProps) {
  const { slug } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const category = await getCategoryBySlug(slug)
  if (!category) notFound()

  const subCategories = category.sub_categories.map((sc) => ({
    id: sc.id,
    category_id: sc.category_id,
    name: sc.name,
    slug: sc.slug,
    description: sc.description ?? null,
    icon: sc.icon ?? null,
    icon_image_url: sc.icon_image_url ?? null,
    sort_order: sc.sort_order,
    is_active: sc.is_active,
    sla_priority: sc.sla_priority,
    created_at: sc.created_at,
    updated_at: sc.updated_at,
  }))

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/admin/categories" className="hover:text-foreground transition-colors">
          Category Management
        </Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <span className="text-foreground">{category.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start gap-4">
        <CategoryIcon
          icon={category.icon}
          iconImageUrl={category.icon_image_url}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl"
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{category.name}</h1>
          {category.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{category.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Manage sub-categories · changes reflect immediately in the service catalog
          </p>
        </div>
      </div>

      {/* Sub-category manager */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <SubCategoryManager
          categoryId={category.id}
          categoryName={category.name}
          initialSubCategories={subCategories}
        />
      </div>
    </div>
  )
}
