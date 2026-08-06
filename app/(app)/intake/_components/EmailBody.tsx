'use client'

import { useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'

// Renders an email faithfully like a real mail client. Prefers the HTML part and
// renders it in a SANDBOXED iframe so the email's CSS can't leak into the app and
// its scripts can't run (no allow-scripts) — the approach Gmail/Outlook/Superhuman
// use. Blocks remote images until the user opts in (defeats tracking pixels).
// Falls back to linkified plain text. Shared by the Inbox and Review screens.
export function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)
  const [showImages, setShowImages] = useState(false)

  const hasHtml = !!html && html.trim().length > 0
  const hasImages = hasHtml && /<img\b/i.test(html!)

  function measure() {
    try {
      const doc = ref.current?.contentDocument
      if (doc?.body) setHeight(doc.body.scrollHeight + 24)
    } catch { /* cross-origin guard */ }
  }

  if (hasHtml) {
    const rendered = showImages
      ? html!
      : html!
          .replace(/(<img\b[^>]*?)\ssrc=/gi, '$1 data-blocked-src=')
          .replace(/(<img\b[^>]*?)\ssrcset=/gi, '$1 data-blocked-srcset=')

    const srcDoc = `<!doctype html><html><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <base target="_blank">
      <style>
        html,body{margin:0;padding:0;background:transparent;}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
             font-size:14px;line-height:1.6;color:#1f2937;word-break:break-word;overflow-wrap:anywhere;}
        img{max-width:100%!important;height:auto;}
        table{max-width:100%!important;}
        a{color:#2563eb;}
        *{max-width:100%;box-sizing:border-box;}
        ::-webkit-scrollbar{display:none;}
      </style></head><body>${rendered}</body></html>`

    return (
      <div>
        {hasImages && !showImages && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="flex items-center gap-1.5"><ImageOff className="h-3.5 w-3.5" /> Remote images are blocked for privacy.</span>
            <button onClick={() => setShowImages(true)} className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-700 hover:bg-amber-100">
              Load images
            </button>
          </div>
        )}
        <iframe
          ref={ref}
          title="Email content"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          onLoad={() => {
            measure()
            ;[300, 800, 1600].forEach(ms => setTimeout(measure, ms))
          }}
          style={{ width: '100%', height, border: 'none', display: 'block' }}
        />
      </div>
    )
  }

  if (text && text.trim()) {
    return (
      <div className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
        {linkify(text)}
      </div>
    )
  }

  return <p className="text-sm text-muted-foreground">(empty body)</p>
}

// Turns bare URLs in plain-text emails into clickable links.
function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer" className="text-primary underline break-all">{part}</a>
      : <span key={i}>{part}</span>,
  )
}
