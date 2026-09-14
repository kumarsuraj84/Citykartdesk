// Stage 4 — persistent conversation state. See STAGE_4_REPORT.md.
// Channel-neutral: no Meta/WhatsApp transport code lives here or anywhere
// under lib/conversations/ — Stage 5 maps a real channel's payloads onto
// ConversationInbound and renders ConversationResult back out.

export * from './types'
export * from './state-machine'
export { processConversationInbound } from './orchestrator'
export {
  findActiveConversation,
  findConversationById,
  findAttachmentsForConversation,
  updateAttachmentStatus,
  type ConversationAttachment,
} from './repository'
