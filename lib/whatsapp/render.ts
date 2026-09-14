import type { ConversationPrompt, ConversationResult } from '@/lib/conversations'
import {
  commandButtonId,
  WHATSAPP_BUTTON_MAX,
  WHATSAPP_BUTTON_TITLE_MAX,
  WHATSAPP_LIST_MAX_ROWS,
  WHATSAPP_LIST_OPEN_BUTTON_MAX,
  WHATSAPP_ROW_TITLE_MAX,
  type WhatsAppListRow,
  type WhatsAppOutboundMessage,
} from './types'

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

function textMessage(body: string): WhatsAppOutboundMessage {
  return { type: 'text', text: { body, preview_url: false } }
}

/**
 * Renders a set of (id, label) options as one or more outbound messages,
 * choosing buttons for a very small set and a list for a larger one, and —
 * since Meta caps a single list message at 10 rows total (Step 9 "respect
 * Meta platform limits" / "paginate ... in a deterministic way ... do not
 * silently drop valid options") — splitting into multiple SEQUENTIAL list
 * messages when there are more than 10. Every message is independently live
 * and interactive, so a user can tap a row from ANY of them; nothing about
 * this requires the renderer or Stage 4 to track "which page" a user is on.
 */
function renderOptionsAsMessages(
  bodyText: string,
  options: { id: string; label: string }[],
  listOpenButtonText = 'Choose'
): WhatsAppOutboundMessage[] {
  if (options.length === 0) return [textMessage(bodyText)]

  if (options.length <= WHATSAPP_BUTTON_MAX) {
    return [
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: options.map((o) => ({
              type: 'reply',
              reply: { id: o.id, title: truncate(o.label, WHATSAPP_BUTTON_TITLE_MAX) },
            })),
          },
        },
      },
    ]
  }

  const messages: WhatsAppOutboundMessage[] = []
  const chunks: { id: string; label: string }[][] = []
  for (let i = 0; i < options.length; i += WHATSAPP_LIST_MAX_ROWS) {
    chunks.push(options.slice(i, i + WHATSAPP_LIST_MAX_ROWS))
  }
  chunks.forEach((chunk, idx) => {
    const rows: WhatsAppListRow[] = chunk.map((o) => ({ id: o.id, title: truncate(o.label, WHATSAPP_ROW_TITLE_MAX) }))
    const header = chunks.length > 1 ? `${bodyText} (${idx + 1}/${chunks.length})` : bodyText
    messages.push({
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: header },
        action: { button: truncate(listOpenButtonText, WHATSAPP_LIST_OPEN_BUTTON_MAX), sections: [{ rows }] },
      },
    })
  })
  return messages
}

function renderMultiselect(prompt: ConversationPrompt): WhatsAppOutboundMessage[] {
  const options = prompt.options ?? []
  const numbered = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
  const label = prompt.message ?? 'Select all that apply'
  return [
    textMessage(
      `${label}\n\n${numbered}\n\nReply with the numbers separated by commas (e.g. 1,3) for every option that applies.`
    ),
  ]
}

function renderReview(prompt: ConversationPrompt): WhatsAppOutboundMessage[] {
  const review = prompt.review
  if (!review) return [textMessage(prompt.message ?? 'Please review your request.')]

  const lines = [
    'Please review your request:',
    '',
    `Service: ${review.serviceName}`,
    ...(review.subCategoryName ? [`Issue: ${review.subCategoryName}`] : []),
    '',
    `Subject:\n${review.title}`,
    ...(review.description ? ['', `Description:\n${review.description}`] : []),
    ...review.fields.map((f) => `\n${f.label}:\n${f.displayValue}`),
  ]
  if (!review.ready) {
    const missing = [...review.missingFields, ...review.invalidFields].map((f) => f.label).join(', ')
    lines.push('', `Still needed: ${missing}`)
  }

  const messages: WhatsAppOutboundMessage[] = [textMessage(lines.join('\n'))]
  if (review.ready) {
    messages.push({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Create this ticket?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: commandButtonId('create'), title: 'Create Ticket' } },
            { type: 'reply', reply: { id: commandButtonId('cancel'), title: 'Cancel' } },
          ],
        },
      },
    })
  }
  return messages
}

/**
 * Step 9 — the isolated ConversationResult -> WhatsApp renderer. Reads only
 * the requester-safe fields Stage 4 already produced; never re-derives or
 * second-guesses a business decision (which options are valid, whether the
 * draft is ready, etc.) — Stage 4 owns progression, this only draws it.
 */
export function renderConversationResult(result: ConversationResult): WhatsAppOutboundMessage[] {
  const prompt = result.prompt
  if (!prompt) return []

  switch (prompt.type) {
    case 'service_selection':
      return renderOptionsAsMessages(prompt.message ?? 'Please choose a service:', prompt.options ?? [], 'Select Service')

    case 'issue_search':
      return [textMessage(prompt.message ?? 'Please type a few words describing your issue.\n\nExample: printer, laptop, password, wifi')]

    case 'subcategory_selection':
      return renderOptionsAsMessages(prompt.message ?? 'I found these matching issues:', prompt.options ?? [], 'Select Issue')

    case 'select':
      return renderOptionsAsMessages(prompt.message ?? 'Please choose one:', prompt.options ?? [], 'Select')

    case 'multiselect':
      return renderMultiselect(prompt)

    case 'date':
      return [textMessage(`${prompt.message ?? 'Please enter a date'}\n\nFormat: DD/MM/YYYY`)]

    case 'number':
      return [textMessage(prompt.message ?? 'Please enter a number.')]

    case 'file':
      return [textMessage(`Please send ${prompt.message ?? 'the required file'} as a photo or document attachment.`)]

    case 'text':
      return [textMessage(prompt.message ?? 'Please describe the issue in a little more detail.')]

    case 'review':
      return renderReview(prompt)

    case 'active_draft_exists':
      return [
        {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text:
                prompt.message ??
                'You already have a request in progress. Continue answering to resume it, or choose an option below.',
            },
            action: {
              buttons: (prompt.options ?? []).slice(0, WHATSAPP_BUTTON_MAX).map((o) => ({
                type: 'reply',
                reply: { id: commandButtonId(o.id), title: truncate(o.label, WHATSAPP_BUTTON_TITLE_MAX) },
              })),
            },
          },
        },
      ]

    case 'completed':
      return [
        textMessage(prompt.message ?? 'Your ticket has been created.'),
        {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: 'Need to raise another request?' },
            action: { buttons: [{ type: 'reply', reply: { id: commandButtonId('new'), title: 'Start New' } }] },
          },
        },
      ]

    case 'cancelled':
    case 'expired':
      return [
        textMessage(prompt.message ?? (prompt.type === 'expired' ? 'Your request has expired.' : 'Request cancelled.')),
        {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: 'Would you like to start a new request?' },
            action: { buttons: [{ type: 'reply', reply: { id: commandButtonId('new'), title: 'Start New' } }] },
          },
        },
      ]

    case 'error':
      return [textMessage(prompt.message ?? 'Something went wrong. Please try again.')]

    default:
      return prompt.message ? [textMessage(prompt.message)] : []
  }
}
