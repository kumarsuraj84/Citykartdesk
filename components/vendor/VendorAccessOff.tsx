import { VENDOR_COMPANY_OFF_TEXT } from '@/lib/vendor/ctx'

/** Shown instead of a vendor page when the vendor company has been switched off by Citykart (Admin > Vendors). */
export function VendorAccessOff() {
  return (
    <div role="alert" className="max-w-xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-semibold">Access switched off</p>
      <p className="mt-1">{VENDOR_COMPANY_OFF_TEXT}</p>
    </div>
  )
}
