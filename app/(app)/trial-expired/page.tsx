import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/actions/auth'

export const metadata = { title: 'Trial Expired' }

export default function TrialExpiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 mx-auto">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Trial period ended</h1>
          <p className="text-muted-foreground">
            Your Citykart Desk trial has expired. To continue using the platform, please contact us to
            activate your subscription.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button render={<a href="mailto:sales@citykart.org" />}>
            Contact sales
          </Button>
          <form action={signOut}>
            <Button variant="outline" type="submit">Sign out</Button>
          </form>
        </div>
      </div>
    </div>
  )
}
