// Prepares the HTML of an incoming e-mail for the review screens (VAPT-046 / VA-INT-12). Runs on the SERVER, so hostile markup never reaches the browser.
//
// Before: the viewer only renamed `src` / `srcset` on <img>, so CSS url(), <link>, <meta http-equiv=refresh>, <base>, <form>, <object>, <video poster>,
// legacy `background=` attributes and similar still loaded remote content (read receipts, tracking) or could move the frame to another address.
// Now: an allow-list of formatting tags and attributes. Everything that can fetch or navigate is removed. The only remote content that can survive is an
// <img src="https://..."> - and its address is moved to data-remote-src, which the viewer turns back into a real src ONLY after the reader clicks "Load images"
// (the viewer also sets a Content-Security-Policy inside the frame as a second barrier).
import sanitizeHtml from 'sanitize-html'

const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel']

/** Removes everything in a piece of CSS that can fetch or run something: url(), @import, expression(), behavior, -moz-binding, image-set(). */
/** Replaces every call `name( ... )` - with nested brackets and quoted text - by `none`. */
function stripCalls(css: string, name: string): string {
  const re = new RegExp(name + '\\s*\\(', 'i')
  let out = css
  for (let guard = 0; guard < 200; guard++) {
    const m = re.exec(out)
    if (!m) break
    let depth = 1, i = m.index + m[0].length, quote = ''
    for (; i < out.length && depth > 0; i++) {
      const ch = out[i]
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = '' }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    out = out.slice(0, m.index) + 'none' + out.slice(i)
  }
  return out
}

export function cleanCss(css: string): string {
  let out = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;?/gi, '')
  for (const name of ['url', 'image-set', 'expression', '-webkit-image-set', 'src']) out = stripCalls(out, name)
  return out.replace(/(behavior|-moz-binding)\s*:[^;}]*/gi, '')
}

export function prepareMailHtml(html: string | null | undefined): string | null {
  if (!html || !html.trim()) return html ?? null
  const out = sanitizeHtml(html, {
    allowedTags: [
      'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
      'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main',
      'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
      'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
    ],
    allowVulnerableTags: true,   // <style> is kept (layout) - its text is cleaned below
    allowedAttributes: {
      '*': ['style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'lang', 'title'],
      a: ['href', 'name', 'title', 'target', 'rel', 'style'],
      img: ['src', 'data-remote-src', 'alt', 'width', 'height', 'title', 'style'],
      font: ['face', 'size', 'color'],
      td: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor', 'style', 'class'],
      th: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor', 'style', 'class'],
      table: ['cellpadding', 'cellspacing', 'border', 'width', 'align', 'bgcolor', 'style', 'class'],
      col: ['span', 'width'],
      colgroup: ['span', 'width'],
      ol: ['start', 'type'],
      li: ['value'],
    },
    allowedSchemes: SAFE_SCHEMES,
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      '*': (tagName, attribs) => {
        const a = { ...attribs }
        if (a.style) a.style = cleanCss(a.style)
        return { tagName, attribs: a }
      },
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, style: attribs.style ? cleanCss(attribs.style) : undefined as unknown as string, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
      img: (tagName, attribs) => {
        const a: Record<string, string> = { ...attribs }
        const src = a.src
        delete a.src
        // Only an address the reader can choose to load is kept, under a name the browser does not fetch. Embedded images (data:image/...) and cid: parts
        // stay as they are; they cost nothing to display.
        if (src && /^https?:\/\//i.test(src)) a['data-remote-src'] = src
        else if (src && /^(cid:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(src)) a.src = src
        if (a.style) a.style = cleanCss(a.style)
        return { tagName, attribs: a }
      },
    },
  })
  // <style> blocks: sanitize-html passes their text through untouched, so it is cleaned here on the normalised output (every <style> in it is a real element)
  return out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, css: string, close: string) => open + cleanCss(css) + close)
}
