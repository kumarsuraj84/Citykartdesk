/**
 * DESK-STORAGE-001 regression suite.
 *
 * Defect: every Storage URL in the app (service/category icons, user
 * avatars, request/intake attachments) was built via getPublicUrl()/
 * createSignedUrl() — both return an ABSOLUTE URL rooted at
 * NEXT_PUBLIC_SUPABASE_URL, which Next.js inlines at build time. On Main
 * that value is http://10.0.1.12:8443 (its LAN-only address); once Main was
 * port-forwarded to a public IP (http://182.72.84.10:3210), every image/
 * attachment <img src>/link pointed at a private address the browser has
 * no route to, so nothing loaded — this is what the user reported as
 * "images not showing after switching to the public IP".
 *
 * Fix: every one of those URLs is now a same-origin relative path served by
 * one of three new route handlers, resolved server-side via the admin
 * client (a same-machine call, unaffected by which external host the
 * browser used to reach the app):
 *   - app/api/storage/public/[bucket]/[...path]/route.ts — icons, avatars
 *     (public buckets, no auth — matches the buckets' own public-read
 *     Storage policy getPublicUrl() relied on).
 *   - app/api/storage/attachment/request/[id]/route.ts — request
 *     attachments (private; re-checks request_attachments' RLS on every
 *     fetch instead of baking access into a signed URL).
 *   - app/api/storage/attachment/intake/[id]/route.ts — intake attachments
 *     (private; re-checks intake_attachments' RLS, forces
 *     Content-Disposition: attachment same as the old signed URL did).
 *
 * These tests call each route's real, unmodified GET handler directly (the
 * same way Next.js itself would invoke it), against the local Supabase
 * Postgres + Storage instance — real RLS, not a re-implementation of it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { setupFixtures, getAdmin, clientForToken, type Fixtures } from '../setup/fixtures'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))

import { createClient } from '@/lib/supabase/server'
const mockedCreateClient = vi.mocked(createClient)

const RUN_TAG = `desk-storage-001-${Date.now()}`

describe('DESK-STORAGE-001: storage proxy routes replace absolute Storage URLs', () => {
  let fx: Fixtures
  const uploadedIconPaths: string[] = []
  let requestId: string
  let attachmentId: string
  const attachmentStoragePath = `${RUN_TAG}/test.txt`

  beforeAll(async () => {
    fx = await setupFixtures()
  }, 30_000)

  afterAll(async () => {
    const admin = getAdmin()
    if (uploadedIconPaths.length > 0) await admin.storage.from('icons').remove(uploadedIconPaths)
    if (requestId) await admin.from('request_attachments').delete().eq('request_id', requestId)
    await admin.storage.from('request-attachments').remove([attachmentStoragePath]).catch(() => {})
    await fx.cleanup()
  }, 30_000)

  it('1. public bucket route (icons) streams the real uploaded bytes back, with the correct content-type', async () => {
    const admin = getAdmin()
    const storagePath = `${RUN_TAG}-icon.png`
    uploadedIconPaths.push(storagePath)
    // A minimal valid 1x1 PNG (magic bytes + IHDR).
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000100000001080600000'.padEnd(64, '0'),
      'hex'
    )
    const { error: uploadError } = await admin.storage.from('icons').upload(storagePath, pngBytes, { contentType: 'image/png' })
    expect(uploadError).toBeNull()

    const { GET } = await import('@/app/api/storage/public/[bucket]/[...path]/route')
    const res = await GET(new NextRequest('http://localhost/api/storage/public/icons/' + storagePath), {
      params: Promise.resolve({ bucket: 'icons', path: [storagePath] }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(pngBytes)).toBe(true)
  })

  it('2. public bucket route rejects an unknown bucket (never a proxy to an arbitrary Storage bucket)', async () => {
    const { GET } = await import('@/app/api/storage/public/[bucket]/[...path]/route')
    const res = await GET(new NextRequest('http://localhost/api/storage/public/request-attachments/x'), {
      params: Promise.resolve({ bucket: 'request-attachments', path: ['x'] }),
    })
    expect(res.status).toBe(404)
  })

  it('3. request-attachment route: the requester can fetch their own attachment', async () => {
    const admin = getAdmin()
    const { data: req, error: reqError } = await admin
      .from('requests')
      .insert({
        request_no: '',
        title: `DESK-STORAGE-001 ${RUN_TAG}`,
        requester_id: fx.requester.id,
        service_id: fx.serviceId,
        team_id: fx.teamId,
        status: 'open',
      })
      .select('id')
      .single()
    expect(reqError).toBeNull()
    requestId = req!.id

    const fileBytes = Buffer.from('desk-storage-001 test attachment')
    const { error: uploadError } = await admin.storage.from('request-attachments').upload(attachmentStoragePath, fileBytes, { contentType: 'text/plain' })
    expect(uploadError).toBeNull()

    const { data: attachment, error: attError } = await admin
      .from('request_attachments')
      .insert({
        request_id: requestId,
        uploaded_by: fx.requester.id,
        file_name: 'test.txt',
        file_size: fileBytes.length,
        mime_type: 'text/plain',
        storage_path: attachmentStoragePath,
      })
      .select('id')
      .single()
    expect(attError).toBeNull()
    attachmentId = attachment!.id

    mockedCreateClient.mockResolvedValue(clientForToken(fx.requester.accessToken) as never)

    const { GET } = await import('@/app/api/storage/attachment/request/[id]/route')
    const res = await GET(new NextRequest('http://localhost/api/storage/attachment/request/' + attachmentId), {
      params: Promise.resolve({ id: attachmentId }),
    })

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('desk-storage-001 test attachment')
  })

  it("4. request-attachment route: an unrelated user (not the requester, not on the team) is denied — RLS, not the route, enforces this", async () => {
    mockedCreateClient.mockResolvedValue(clientForToken(fx.otherRequester.accessToken) as never)

    const { GET } = await import('@/app/api/storage/attachment/request/[id]/route')
    const res = await GET(new NextRequest('http://localhost/api/storage/attachment/request/' + attachmentId), {
      params: Promise.resolve({ id: attachmentId }),
    })

    expect(res.status).toBe(404)
  })

  it('5. request-attachment route: a non-existent id returns 404, not a crash', async () => {
    mockedCreateClient.mockResolvedValue(clientForToken(fx.requester.accessToken) as never)

    const { GET } = await import('@/app/api/storage/attachment/request/[id]/route')
    const res = await GET(new NextRequest('http://localhost/api/storage/attachment/request/00000000-0000-0000-0000-000000000000'), {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
    })

    expect(res.status).toBe(404)
  })

  it('6. intake-attachment route: an agent (role gated by intake_attachments RLS) can fetch it, forced as a download, and a plain requester cannot', async () => {
    const admin = getAdmin()
    const intakeStoragePath = `${RUN_TAG}/intake-test.txt`
    const fileBytes = Buffer.from('desk-storage-001 intake test attachment')

    const { data: channel, error: channelError } = await admin
      .from('intake_channels')
      .insert({ org_id: fx.orgId, type: 'email', name: `${RUN_TAG}-channel`, status: 'active' })
      .select('id')
      .single()
    expect(channelError).toBeNull()

    const { data: message, error: msgError } = await admin
      .from('intake_messages')
      .insert({ org_id: fx.orgId, channel_id: channel!.id, subject: RUN_TAG, status: 'new' })
      .select('id')
      .single()
    expect(msgError).toBeNull()

    const { error: uploadError } = await admin.storage.from('intake-attachments').upload(intakeStoragePath, fileBytes, { contentType: 'text/plain' })
    expect(uploadError).toBeNull()

    const { data: intakeAttachment, error: attError } = await admin
      .from('intake_attachments')
      .insert({ org_id: fx.orgId, message_id: message!.id, file_name: 'intake-test.txt', file_size: fileBytes.length, mime_type: 'text/plain', storage_path: intakeStoragePath })
      .select('id')
      .single()
    expect(attError).toBeNull()

    try {
      mockedCreateClient.mockResolvedValue(clientForToken(fx.agent.accessToken) as never)
      const { GET } = await import('@/app/api/storage/attachment/intake/[id]/route')
      const res = await GET(new NextRequest('http://localhost/api/storage/attachment/intake/' + intakeAttachment!.id), {
        params: Promise.resolve({ id: intakeAttachment!.id }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-disposition')).toContain('attachment')
      expect(await res.text()).toBe('desk-storage-001 intake test attachment')

      // Plain requester role isn't in intake_attachments_select's role list —
      // RLS denies the SELECT outright, same as the request-attachment case.
      mockedCreateClient.mockResolvedValue(clientForToken(fx.requester.accessToken) as never)
      const res2 = await GET(new NextRequest('http://localhost/api/storage/attachment/intake/' + intakeAttachment!.id), {
        params: Promise.resolve({ id: intakeAttachment!.id }),
      })
      expect(res2.status).toBe(404)
    } finally {
      await admin.from('intake_attachments').delete().eq('id', intakeAttachment!.id)
      await admin.storage.from('intake-attachments').remove([intakeStoragePath])
      await admin.from('intake_messages').delete().eq('id', message!.id)
      await admin.from('intake_channels').delete().eq('id', channel!.id)
    }
  })
})
