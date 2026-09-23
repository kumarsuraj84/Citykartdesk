'use client'

import { useState } from 'react'

// Shared icon-box renderer for Category/Sub-Category rows and the Service
// Catalog — prefers an uploaded image (icon_image_url) over the emoji (icon)
// whenever set. Falls back to the emoji if the image itself fails to load
// (e.g. the file no longer exists in storage) — without this, a broken
// image reference showed the browser's broken-image icon instead of the
// emoji fallback the empty-iconImageUrl case already had.
//
// onError alone is not enough for a server-rendered <img>: the browser
// starts loading it straight from the SSR'd HTML, before React hydrates and
// attaches the handler — for an already-fast failure (e.g. a 404 on
// localhost) the error event fires and is gone before onError exists to
// catch it, and unlike click-type events React does not replay load/error
// events after hydration. The ref callback below covers exactly that gap:
// it runs at hydration/mount and checks whether the browser already gave up
// on this exact image (complete === true with no actual pixels loaded).
export function CategoryIcon({
  icon,
  iconImageUrl,
  className,
}: {
  icon: string | null
  iconImageUrl?: string | null
  className: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  // Reset when the URL itself changes (e.g. a different row, or a freshly
  // re-uploaded icon) — otherwise a stale failure would permanently hide a
  // perfectly good new image. Adjusted during render, not an effect: this
  // codebase's own pattern for "reset local state when a prop changes"
  // (see RequestBoardView/TaskTable/NotificationBell etc.) — an effect here
  // would cause an extra cascading render for no benefit.
  const [prevUrl, setPrevUrl] = useState(iconImageUrl)
  if (prevUrl !== iconImageUrl) {
    setPrevUrl(iconImageUrl)
    setImageFailed(false)
  }

  const showImage = iconImageUrl && !imageFailed

  return (
    <div className={`overflow-hidden ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase storage URL not in next.config's remote patterns
        <img
          src={iconImageUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0) setImageFailed(true)
          }}
        />
      ) : (
        icon ?? '📋'
      )}
    </div>
  )
}
