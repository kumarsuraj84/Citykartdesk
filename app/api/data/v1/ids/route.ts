import { NextRequest } from 'next/server'
import { handleDataApi } from '@/lib/data-api/handler'

// Read-only data API for the data platform (token in Authorization: Bearer). See lib/data-api and docs/CKDESK-DATA-API.md.
export async function GET(req: NextRequest) {
  return handleDataApi(req, 'ids')
}
