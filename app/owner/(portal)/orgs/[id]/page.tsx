import { OwnerOrgDetailClient } from '@/components/owner/OwnerOrgDetailClient'

export const metadata = { title: 'Organization Detail' }

export default async function OwnerOrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OwnerOrgDetailClient id={id} />
}
