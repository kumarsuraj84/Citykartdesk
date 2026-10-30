// The public storage route (app/api/storage/public/[bucket]/[...path]/route.ts) serves the two public buckets with the server's
// elevated storage client, so the path it is asked for must be validated BEFORE it reaches that client (audit finding D-051 / SEC-39).
// Only the exact shapes the application itself uploads are allowed:
//   icons/<uuid>.<png|jpg|jpeg|gif|webp>        (lib/actions/admin/icons.ts)
//   avatars/<user uuid>/avatar.<png|jpg|jpeg|gif|webp>   (lib/actions/profile.ts)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const EXT = '(png|jpe?g|gif|webp)'
const SHAPES: Record<string, RegExp> = {
  // String.raw keeps the backslash: in a plain template literal "\." is just "." (any character), which loosened the dot (VAPT VA-API-14)
  icons: new RegExp(String.raw`^${UUID}\.${EXT}$`, 'i'),
  avatars: new RegExp(String.raw`^${UUID}/avatar\.${EXT}$`, 'i'),
}

export const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** The validated storage path for a public bucket, or null when it is not one of the shapes the app uploads. */
export function safePublicStoragePath(bucket: string, segments: string[]): string | null {
  const shape = SHAPES[bucket]
  if (!shape || !Array.isArray(segments) || segments.length === 0 || segments.length > 2) return null
  for (const seg of segments) {
    if (typeof seg !== 'string' || seg === '' || seg === '.' || seg === '..' || /[\/%?#\u0000-\u001f]/.test(seg)) return null
  }
  const path = segments.join('/')
  return shape.test(path) ? path : null
}

export function contentTypeForPath(path: string): string {
  return CONTENT_TYPE_BY_EXT[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Is this text the address of THIS person's own avatar file (`/api/storage/public/avatars/<their id>/avatar.<ext>`, exactly what uploadAvatar writes)?
 * An empty value is also accepted (it clears the picture). Nothing else is: not an outside address, not another person's folder (audit A-15).
 */
export function isOwnAvatarUrl(value: unknown, userId: string): boolean {
  if (value === '') return true
  if (typeof value !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(userId)) return false
  const prefix = '/api/storage/public/avatars/'
  if (!value.startsWith(prefix)) return false
  const rest = value.slice(prefix.length)
  return rest.toLowerCase().startsWith(`${userId.toLowerCase()}/`) && SHAPES.avatars.test(rest)
}
