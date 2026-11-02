import type { NextRequest } from 'next/server'
import { forwardToCkoneai } from '@/lib/ckoneai/forward'

// The assistant's chat page and its files, served through the CK Desk server (same address, so the page needs no login of its own).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = (req: NextRequest) => forwardToCkoneai(req)
export const HEAD = (req: NextRequest) => forwardToCkoneai(req)
