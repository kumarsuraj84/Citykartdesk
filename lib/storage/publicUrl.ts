// DESK-STORAGE-001: the single place that constructs a browser-facing URL
// for a PUBLIC Storage bucket (icons, avatars). Deliberately NOT
// `admin.storage.from(bucket).getPublicUrl(path)` — that returns an
// absolute URL rooted at NEXT_PUBLIC_SUPABASE_URL, which is inlined at
// build time and was set to Main's LAN-only address, making every icon/
// avatar unreachable from a browser on the port-forwarded public IP. This
// returns a same-origin relative path instead, served by
// app/api/storage/public/[bucket]/[...path]/route.ts — see that file for
// the full writeup.
// Kept in sync with PUBLIC_BUCKETS in app/api/storage/public/[bucket]/[...path]/route.ts.
export type PublicStorageBucket = 'icons' | 'avatars'

export function buildPublicStorageUrl(bucket: PublicStorageBucket, path: string): string {
  return `/api/storage/public/${bucket}/${path}`
}
