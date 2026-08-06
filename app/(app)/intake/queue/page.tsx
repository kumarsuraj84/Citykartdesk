import { redirect } from 'next/navigation'

// The Queue merged into the unified Inbox (folders reslice the same dataset).
// Keep this route as a redirect so existing links/bookmarks land on the
// "Needs Review" folder.
export default function IntakeQueuePage() {
  redirect('/intake/inbox?folder=review')
}
