#!/usr/bin/env node
/**
 * DESK-STORAGE-001 data migration — rewrites existing absolute Storage URLs
 * (rooted at whatever NEXT_PUBLIC_SUPABASE_URL was baked in at the time of
 * upload) into the new same-origin relative form served by
 * app/api/storage/public/[bucket]/[...path]/route.ts. Only the CODE fix
 * (already deployed) makes NEW uploads relative — rows uploaded before this
 * fix still carry the old absolute URL and need this one-time rewrite to
 * actually load again.
 *
 * Read-only by default (--apply required to write). Matches ANY host in the
 * stored URL (not just the current NEXT_PUBLIC_SUPABASE_URL) — some rows may
 * predate an earlier URL change too — by pattern-matching the fixed
 * "/storage/v1/object/public/<bucket>/<path>" suffix every getPublicUrl()
 * result has, regardless of host.
 *
 * Usage: node scripts/migrate-storage-urls.mjs [--apply]
 */
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
try { process.loadEnvFile(path.resolve(__dirname, '../.env.local')) } catch {}
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket

const APPLY = process.argv.includes('--apply')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Matches http(s)://<any host>/storage/v1/object/public/<bucket>/<path> —
// captures bucket and path so we can reconstruct the same relative URL
// buildPublicStorageUrl() (lib/storage/publicUrl.ts) would build today.
const OLD_URL_PATTERN = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/

function toRelative(oldUrl) {
  const m = OLD_URL_PATTERN.exec(oldUrl)
  if (!m) return null
  const [, bucket, objectPath] = m
  return `/api/storage/public/${bucket}/${objectPath}`
}

async function migrateColumn(table, column, filterCol = 'id') {
  const { data, error } = await admin.from(table).select(`${filterCol}, ${column}`).like(column, 'http%')
  if (error) throw new Error(`${table}.${column} select failed: ${error.message}`)

  let rewritten = 0, skipped = 0
  for (const row of data ?? []) {
    const oldUrl = row[column]
    const relative = toRelative(oldUrl)
    if (!relative) { skipped++; console.log(`  [skip] ${table}.${filterCol}=${row[filterCol]}: doesn't match expected pattern: ${oldUrl}`); continue }
    console.log(`  ${APPLY ? '[apply]' : '[dry-run]'} ${table}.${filterCol}=${row[filterCol]}: ${oldUrl} -> ${relative}`)
    if (APPLY) {
      const { error: updateError } = await admin.from(table).update({ [column]: relative }).eq(filterCol, row[filterCol])
      if (updateError) throw new Error(`${table}.${column} update failed for ${filterCol}=${row[filterCol]}: ${updateError.message}`)
    }
    rewritten++
  }
  console.log(`[${table}.${column}] ${rewritten} ${APPLY ? 'rewritten' : 'would be rewritten'}, ${skipped} skipped (unrecognized format)`)
  return { rewritten, skipped }
}

async function main() {
  console.log(`=== DESK-STORAGE-001 URL migration (${APPLY ? 'APPLY' : 'DRY RUN — pass --apply to write'}) ===\n`)
  const targets = [
    ['services', 'icon_image_url'],
    ['service_categories', 'icon_image_url'],
    ['service_sub_categories', 'icon_image_url'],
    ['profiles', 'avatar_url'],
  ]
  let totalRewritten = 0, totalSkipped = 0
  for (const [table, column] of targets) {
    const { rewritten, skipped } = await migrateColumn(table, column)
    totalRewritten += rewritten
    totalSkipped += skipped
  }
  console.log(`\nTotal: ${totalRewritten} ${APPLY ? 'rewritten' : 'would be rewritten'}, ${totalSkipped} skipped.`)
  if (!APPLY && totalRewritten > 0) console.log('Re-run with --apply to write these changes.')
}

main().catch((err) => { console.error('migration failed:', err); process.exit(1) })
