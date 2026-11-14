import { AlertTriangle } from 'lucide-react'

/**
 * Shown instead of a report when the app cannot read the Zoho database. It never says anything secret - only what has to be
 * put right, and where. Nothing else in CK Desk is affected while this is showing.
 */
export function NotConnected({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200">The Zoho data cannot be read just now.</p>
          <p className="text-amber-800 dark:text-amber-300">{reason}</p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Nothing else in CK Desk is affected - only these Zoho pages. The settings live on the application server, in the file
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900/40">app\standalone\.env.local</code>
            (ZOHO_DB_HOST, ZOHO_DB_USER, ZOHO_DB_PASSWORD). After changing it the application has to be restarted.
          </p>
        </div>
      </div>
    </div>
  )
}
