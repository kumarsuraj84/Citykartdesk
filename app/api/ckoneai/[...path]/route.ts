import type { NextRequest } from 'next/server'
import { forwardToCkoneai } from '@/lib/ckoneai/forward'

// The assistant's API, forwarded to CKOneAI by the CK Desk server with a signed identity. See lib/ckoneai/forward.ts and docs/CKDESK-BOT-VIA-CKONEAI.md.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = (req: NextRequest) => forwardToCkoneai(req)
export const POST = (req: NextRequest) => forwardToCkoneai(req)
export const DELETE = (req: NextRequest) => forwardToCkoneai(req)
