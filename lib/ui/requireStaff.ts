import { redirect } from 'next/navigation'
import { isVendor, vendorLandingFor, type VendorProfileLike } from '@/lib/vendor/access'

/**
 * Sends an OEM engineer (vendor login) away from a staff page, to his own page.
 * The app layout already does this, but a layout does not run again when the person moves between pages inside the app,
 * so each staff page that matters calls this too, with the profile it already loaded.
 */
export function requireStaff(profile: VendorProfileLike | null | undefined, path: string): void {
  if (isVendor(profile)) redirect(vendorLandingFor(path))
}
