import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'

export default async function AdminPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') redirect('/home')
  redirect('/admin/users')
}
