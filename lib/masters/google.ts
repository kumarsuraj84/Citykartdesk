import 'server-only'
import { fetchWithTimeout } from '@/lib/http/fetch-timeout'
import { providerConfig } from '@/lib/intake/oauth'

// Read-only access to the master Google Sheets. The only permission asked of the Google account is "view your spreadsheets".

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

/** Where the sheet rows come from. The real one is Google; tests use files or fixed rows. */
export interface SheetsSource {
  fetchValues(spreadsheetId: string, tabName: string | null): Promise<unknown[][]>
  /** The same sheet as it is SHOWN (dates as dates, '007' as '007', long numbers with every digit). Optional; used for the cells a person reads as text. */
  fetchDisplayValues?(spreadsheetId: string, tabName: string | null): Promise<unknown[][]>
}

export class SheetsAccessError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'no_access' | 'not_found' | 'api_off' | 'other') {
    super(message)
  }
}

let cachedToken: { refreshToken: string; accessToken: string; expiresAt: number } | null = null

async function accessTokenFor(refreshToken: string): Promise<string> {
  if (cachedToken && cachedToken.refreshToken === refreshToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken
  const cfg = providerConfig('google')
  if (!cfg.clientId || !cfg.clientSecret) throw new SheetsAccessError('The Google OAuth client is not configured on the server.', 'auth')
  const res = await fetchWithTimeout(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new SheetsAccessError(
      data.error === 'invalid_grant'
        ? 'Google no longer accepts the saved connection (the account password changed or access was removed). Connect Google Sheets again.'
        : (data.error_description ?? data.error ?? 'Could not get access from Google.'),
      'auth',
    )
  }
  cachedToken = { refreshToken, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return data.access_token
}

async function sheetsGet(url: string, token: string): Promise<unknown> {
  const res = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${token}` } })
  if (res.ok) return res.json()
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } }
  const msg = body.error?.message ?? res.statusText
  if (res.status === 404) throw new SheetsAccessError('Google cannot find this sheet. Check the sheet link / id.', 'not_found')
  if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(msg)) throw new SheetsAccessError('The Google Sheets API is switched off for the Google project. Switch it on in the Google Cloud console.', 'api_off')
  if (res.status === 403 || res.status === 401) throw new SheetsAccessError('The connected Google account cannot open this sheet. Share the sheet with it as Viewer.', 'no_access')
  throw new SheetsAccessError(`Google answered ${res.status}: ${msg}`, 'other')
}

export function googleSheetsSource(refreshToken: string): SheetsSource {
  async function read(spreadsheetId: string, tabName: string | null, render: string): Promise<unknown[][]> {
    const token = await accessTokenFor(refreshToken)
    const id = encodeURIComponent(spreadsheetId)
    let tab = tabName
    if (!tab) {
      const meta = (await sheetsGet(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`, token)) as { sheets?: { properties?: { title?: string } }[] }
      tab = meta.sheets?.[0]?.properties?.title ?? null
      if (!tab) throw new SheetsAccessError('The sheet has no tab.', 'other')
    }
    const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`)
    const data = (await sheetsGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?majorDimension=ROWS&valueRenderOption=${render}&dateTimeRenderOption=${render === 'FORMATTED_VALUE' ? 'FORMATTED_STRING' : 'SERIAL_NUMBER'}`,
      token,
    )) as { values?: unknown[][] }
    return data.values ?? []
  }
  return {
    fetchValues: (spreadsheetId, tabName) => read(spreadsheetId, tabName, 'UNFORMATTED_VALUE'),
    fetchDisplayValues: (spreadsheetId, tabName) => read(spreadsheetId, tabName, 'FORMATTED_VALUE'),
  }
}

/** The sheet id out of a pasted link (https://docs.google.com/spreadsheets/d/<id>/edit...) or a bare id. */
export function spreadsheetIdFrom(input: string): string | null {
  const t = input.trim()
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(t)
  if (m) return m[1]
  return /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : null
}
