import sanitizeHtml from 'sanitize-html'

// Server-side only. An admin-authored template is still run through this on save AND again at
// send time, so nothing but plain formatting (text styles, lists, links, tables) can ever reach
// an email: no scripts, event handlers, iframes, images, or javascript: links.

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i]
const SIZE = [/^\d{1,4}(\.\d+)?(px|%)$/]
const ALIGN = [/^(left|center|right|justify)$/]

export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'hr',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'span', 'div',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      th: ['colspan', 'rowspan', 'style'],
      td: ['colspan', 'rowspan', 'style'],
      col: ['span', 'style'],
      table: ['style'],
      span: ['style'],
      p: ['style'],
      h1: ['style'], h2: ['style'], h3: ['style'],
    },
    allowedStyles: {
      '*': {
        color: COLOR,
        'background-color': COLOR,
        'text-align': ALIGN,
        width: SIZE,
        'min-width': SIZE,
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
    },
  })
}
