import { redirect } from 'next/navigation'

// The three logs now live together under Logs; old links and bookmarks land on the right tab.
export default function SystemLogRedirect() {
  redirect('/admin/logs?tab=system')
}
