// Stage 5 — Meta WhatsApp Cloud API transport types. Nothing in this file
// (or anywhere under lib/whatsapp/) decides business logic — it only shapes
// Meta's wire format on the way in and out. All ticket/questionnaire/state
// decisions stay in lib/conversations (Stage 4) and lib/requests (Stage 1-3).
import { z } from 'zod'

// ── Inbound webhook payload (Meta -> us) ────────────────────────────────────
// Schema intentionally permissive (.passthrough()) — Meta adds fields over
// time (e.g. new message types, new status fields) and an unrecognized
// field must never fail parsing; only the fields we actually read are typed.

export const MetaMediaObjectSchema = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  filename: z.string().optional(),
  caption: z.string().optional(),
}).passthrough()

export const MetaInteractiveReplySchema = z.object({
  type: z.string(),
  button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
  list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
}).passthrough()

export const MetaMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: MetaInteractiveReplySchema.optional(),
  button: z.object({ text: z.string(), payload: z.string() }).optional(),
  image: MetaMediaObjectSchema.optional(),
  document: MetaMediaObjectSchema.optional(),
  audio: MetaMediaObjectSchema.optional(),
  video: MetaMediaObjectSchema.optional(),
  sticker: MetaMediaObjectSchema.optional(),
}).passthrough()

export const MetaStatusErrorSchema = z.object({
  code: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
}).passthrough()

export const MetaStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
  recipient_id: z.string().optional(),
  errors: z.array(MetaStatusErrorSchema).optional(),
}).passthrough()

export const MetaContactSchema = z.object({
  wa_id: z.string(),
  profile: z.object({ name: z.string().optional() }).optional(),
}).passthrough()

export const MetaValueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z.object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string(),
  }),
  contacts: z.array(MetaContactSchema).optional(),
  messages: z.array(MetaMessageSchema).optional(),
  statuses: z.array(MetaStatusSchema).optional(),
}).passthrough()

export const MetaChangeSchema = z.object({
  value: MetaValueSchema,
  field: z.string(),
}).passthrough()

export const MetaEntrySchema = z.object({
  id: z.string(),
  changes: z.array(MetaChangeSchema),
}).passthrough()

export const MetaWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(MetaEntrySchema),
}).passthrough()

export type MetaMediaObject = z.infer<typeof MetaMediaObjectSchema>
export type MetaMessage = z.infer<typeof MetaMessageSchema>
export type MetaStatus = z.infer<typeof MetaStatusSchema>
export type MetaContact = z.infer<typeof MetaContactSchema>
export type MetaValue = z.infer<typeof MetaValueSchema>
export type MetaChange = z.infer<typeof MetaChangeSchema>
export type MetaEntry = z.infer<typeof MetaEntrySchema>
export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>

// Message types this stage explicitly understands. Everything else (location,
// contacts, reaction, unknown interactive subtypes, etc.) is handled safely
// by falling through to the "unsupported" branch (Step 18) — never crashes,
// never silently treated as text.
export const SUPPORTED_MEDIA_TYPES = ['image', 'document', 'audio', 'video'] as const
export type SupportedMetaMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number]

// ── Per-channel secret shape (stored via intake_store_credential) ──────────

export const WhatsAppSecretSchema = z.object({
  type: z.literal('whatsapp'),
  access_token: z.string().min(1),
  app_secret: z.string().min(1),
  verify_token: z.string().min(1),
})
export type WhatsAppSecret = z.infer<typeof WhatsAppSecretSchema>

// Non-secret config stored on intake_channels.config (JSONB).
export type WhatsAppChannelConfig = {
  phone_number_id: string
  waba_id?: string
  display_name?: string
  api_version?: string
}

// ── Outbound Graph API message payloads (us -> Meta) ────────────────────────
// Documented Meta Cloud API limits (Step 9 "respect Meta platform limits" /
// Step 22) as of this stage's implementation — verified against current
// Meta for Developers documentation, not assumed from memory:
//   - interactive list message: max 10 rows total across max 10 sections
//   - row title <= 24 chars, row description <= 72 chars
//   - list "button" (the label that opens the list) <= 20 chars
//   - interactive reply-button message: max 3 buttons, each title <= 20 chars
export const WHATSAPP_LIST_MAX_ROWS = 10
export const WHATSAPP_LIST_MAX_SECTIONS = 10
export const WHATSAPP_BUTTON_MAX = 3
export const WHATSAPP_ROW_TITLE_MAX = 24
export const WHATSAPP_ROW_DESC_MAX = 72
export const WHATSAPP_BUTTON_TITLE_MAX = 20
export const WHATSAPP_LIST_OPEN_BUTTON_MAX = 20

export type WhatsAppButton = { type: 'reply'; reply: { id: string; title: string } }
export type WhatsAppListRow = { id: string; title: string; description?: string }
export type WhatsAppListSection = { title?: string; rows: WhatsAppListRow[] }

export type WhatsAppInteractivePayload =
  | { type: 'button'; body: { text: string }; action: { buttons: WhatsAppButton[] } }
  | {
      type: 'list'
      header?: { type: 'text'; text: string }
      body: { text: string }
      footer?: { text: string }
      action: { button: string; sections: WhatsAppListSection[] }
    }

export type WhatsAppOutboundMessage =
  | { type: 'text'; text: { body: string; preview_url?: boolean } }
  | { type: 'interactive'; interactive: WhatsAppInteractivePayload }

// A namespaced button/row id that always means "send this literal Stage 4
// command string back through processConversationInbound", never a real
// business selection id (a sub-category uuid, a select-field option value).
// This removes any ambiguity between the two without needing a lookup: a
// business id is passed through completely unmodified (Stage 4 revalidates
// it against the canonical result set it actually presented), while a
// command id always carries this prefix.
const COMMAND_ID_PREFIX = 'cmd:'

export function commandButtonId(command: string): string {
  return `${COMMAND_ID_PREFIX}${command}`
}

export function parseCommandButtonId(id: string): string | null {
  return id.startsWith(COMMAND_ID_PREFIX) ? id.slice(COMMAND_ID_PREFIX.length) : null
}
