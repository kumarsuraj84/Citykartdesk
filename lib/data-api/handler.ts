import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDataApiToken } from './auth'
import { entityByName, ENTITIES } from './entities'
import { parseParams, API_VERSION } from './params'
import { readPage, readIds, readMeta, resolveOrgId, cursorFitsEntity } from './query'

// The read-only data API for the data platform (DBA): GET only, token only, no write path, nothing but the columns listed in ./entities. See docs/CKDESK-DATA-API.md.
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Data-Api-Version': String(API_VERSION) } })

export async function handleDataApi(req: NextRequest, kind: 'meta' | 'rows' | 'ids') {
  const auth = verifyDataApiToken(req)
  if (auth === 'off') return json({ error: 'The data API is not switched on (DATA_API_TOKEN is not configured).' }, 503)
  if (auth === 'hidden') return json({ error: 'Not found' }, 404)
  if (auth === 'denied') return json({ error: 'Unauthorized' }, 401)

  const admin = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const orgId = await resolveOrgId(admin)
    if (!orgId) return json({ error: 'More than one organisation exists: set DATA_API_ORG_ID.' }, 503)

    if (kind === 'meta') {
      return json({ version: API_VERSION, generated_at: new Date().toISOString(), max_page_size: 5000, entities: await readMeta(admin, orgId) })
    }

    const p = parseParams(req.nextUrl.searchParams)
    if (!p.ok) return json({ error: p.error }, 400)
    const def = entityByName(p.entity)
    if (!def) return json({ error: `Unknown entity. Known: ${ENTITIES.map((e) => e.name).join(', ')}.` }, 404)

    if (!cursorFitsEntity(def, p.after)) return json({ error: 'after is not a cursor given by this API for this entity (use next_after of the previous page).' }, 400)

    if (kind === 'ids') {
      const page = await readIds(admin, orgId, def, { limit: p.limit, after: p.after })
      return json({ version: API_VERSION, entity: def.name, generated_at: new Date().toISOString(), ...page })
    }
    const page = await readPage(admin, orgId, def, { limit: p.limit, since: p.since, after: p.after })
    return json({ version: API_VERSION, entity: def.name, generated_at: new Date().toISOString(), ...page })
  } catch (e) {
    console.error('[data-api] failed', kind, e instanceof Error ? e.message : e)
    return json({ error: 'The data API could not read this page. Try again.' }, 500)
  }
}
