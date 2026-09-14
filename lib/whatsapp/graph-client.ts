import type { WhatsAppOutboundMessage } from './types'

export type FetchLike = typeof fetch

export type GraphErrorClass = 'retryable' | 'non_retryable' | 'auth'

export type GraphSendResult =
  | { ok: true; messageId: string }
  | { ok: false; errorClass: GraphErrorClass; status: number; message: string }

export type GraphMediaUrlResult =
  | { ok: true; url: string; mimeType: string | null; sha256: string | null; fileSize: number | null }
  | { ok: false; errorClass: GraphErrorClass; status: number; message: string }

export type GraphDownloadResult =
  | { ok: true; buffer: Buffer; contentType: string | null }
  | { ok: false; errorClass: GraphErrorClass; status: number; message: string }

/**
 * Isolated Meta Graph API client (Step 14 — no business logic here, just
 * building requests, loading the token server-side, parsing responses, and
 * classifying errors). `fetchImpl` is injectable (Step 25 test mode) so
 * unit/integration tests exercise real render/adapter/orchestrator code
 * while mocking only this one HTTP boundary — never lib/conversations.
 */
export class WhatsAppGraphClient {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private baseUrl(path: string): string {
    return `https://graph.facebook.com/${this.apiVersion}/${path}`
  }

  private classify(status: number): GraphErrorClass {
    if (status === 401 || status === 403) return 'auth'
    if (status === 429 || status >= 500) return 'retryable'
    return 'non_retryable'
  }

  async sendMessage(to: string, message: WhatsAppOutboundMessage): Promise<GraphSendResult> {
    try {
      const res = await this.fetchImpl(this.baseUrl(`${this.phoneNumberId}/messages`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message }),
      })
      const body = await res.json().catch(() => null) as {
        messages?: { id: string }[]
        error?: { message?: string; code?: number }
      } | null

      if (!res.ok) {
        return {
          ok: false,
          errorClass: this.classify(res.status),
          status: res.status,
          // Never include the token — only Meta's own error message, which
          // does not echo request headers/credentials back.
          message: body?.error?.message ?? `Graph API send failed [${res.status}]`,
        }
      }
      const messageId = body?.messages?.[0]?.id
      if (!messageId) return { ok: false, errorClass: 'non_retryable', status: res.status, message: 'No message id in Graph API response.' }
      return { ok: true, messageId }
    } catch (err) {
      return { ok: false, errorClass: 'retryable', status: 0, message: err instanceof Error ? err.message : 'Network error calling Graph API.' }
    }
  }

  async getMediaUrl(mediaId: string): Promise<GraphMediaUrlResult> {
    try {
      const res = await this.fetchImpl(this.baseUrl(mediaId), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      const body = await res.json().catch(() => null) as {
        url?: string; mime_type?: string; sha256?: string; file_size?: number; error?: { message?: string }
      } | null
      if (!res.ok || !body?.url) {
        return {
          ok: false,
          errorClass: this.classify(res.status),
          status: res.status,
          message: body?.error?.message ?? `Graph API media lookup failed [${res.status}]`,
        }
      }
      return {
        ok: true,
        url: body.url,
        mimeType: body.mime_type ?? null,
        sha256: body.sha256 ?? null,
        fileSize: typeof body.file_size === 'number' ? body.file_size : null,
      }
    } catch (err) {
      return { ok: false, errorClass: 'retryable', status: 0, message: err instanceof Error ? err.message : 'Network error calling Graph API.' }
    }
  }

  /** The media URL Meta returns is short-lived (~5 minutes) and itself
   *  requires the same bearer token — never persisted, only used once. */
  async downloadMedia(url: string): Promise<GraphDownloadResult> {
    try {
      const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.accessToken}` } })
      if (!res.ok) {
        return { ok: false, errorClass: this.classify(res.status), status: res.status, message: `Media download failed [${res.status}]` }
      }
      const arrayBuffer = await res.arrayBuffer()
      return { ok: true, buffer: Buffer.from(arrayBuffer), contentType: res.headers.get('content-type') }
    } catch (err) {
      return { ok: false, errorClass: 'retryable', status: 0, message: err instanceof Error ? err.message : 'Network error downloading media.' }
    }
  }

  /** Step 24 / Stage 6 Part 2 — verifies credentials/reachability without
   *  sending a message to any real user: reads back the phone number's own
   *  metadata. Stage 5 requested `verified_name` in the fields param but
   *  never actually read it back from the response — fixed here so a
   *  readiness check can report both fields Part 2 explicitly asks for. */
  async testConnection(): Promise<{ ok: true; displayPhoneNumber: string | null; verifiedName: string | null } | { ok: false; message: string }> {
    try {
      const res = await this.fetchImpl(this.baseUrl(`${this.phoneNumberId}?fields=display_phone_number,verified_name`), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      const body = await res.json().catch(() => null) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } } | null
      if (!res.ok) return { ok: false, message: body?.error?.message ?? `Connection test failed [${res.status}]` }
      return { ok: true, displayPhoneNumber: body?.display_phone_number ?? null, verifiedName: body?.verified_name ?? null }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Network error reaching Graph API.' }
    }
  }
}
