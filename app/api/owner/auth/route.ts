import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const COOKIE = 'owner_token'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function getSecret(): string {
  return process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
}

// POST /api/owner/auth  { secret: string } → sets owner_token cookie
export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({ secret: '' }))

  if (!secret || secret !== getSecret()) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const cookieStore = await cookies()
  cookieStore.set(COOKIE, getSecret(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })

  return NextResponse.json({ ok: true })
}

// DELETE /api/owner/auth → clears cookie
export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE, '', { maxAge: 0, path: '/' })
  return NextResponse.json({ ok: true })
}
