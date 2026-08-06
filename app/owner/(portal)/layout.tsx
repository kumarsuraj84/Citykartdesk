import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { OwnerShell } from '@/components/owner/OwnerShell'

export default async function OwnerPortalLayout({ children }: { children: React.ReactNode }) {
  const secret = process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
  const cookieStore = await cookies()
  const token = cookieStore.get('owner_token')

  if (!token || token.value !== secret) {
    redirect('/owner/login')
  }

  return <OwnerShell>{children}</OwnerShell>
}
