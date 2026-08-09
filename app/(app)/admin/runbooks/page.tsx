import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import RunbooksClient from './RunbooksClient'

export const metadata = {
  title: 'Admin Runbooks',
}

export default async function RunbooksPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner') redirect('/home')

  return <RunbooksClient />
}
