'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { GalleryItem } from '@/lib/attachments/gallery-order'

/**
 * Every file of ONE ticket, in the order they appear on the page. The attachment preview uses
 * it so the arrows (and the left/right keys) can step through the whole ticket instead of only
 * the files under one message. It carries only what the preview needs, never anyone else's data.
 * (The ordering itself is in lib/attachments/gallery-order.ts, so server pages can call it.)
 */
const GalleryContext = createContext<GalleryItem[] | null>(null)

export function AttachmentGalleryProvider({ items, children }: { items: GalleryItem[]; children: ReactNode }) {
  // The server hands a fresh array on every refresh; keep the same list while its content is the same.
  const key = items.map((i) => `${i.id}|${i.signedUrl}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => items, [key])
  return <GalleryContext.Provider value={stable}>{children}</GalleryContext.Provider>
}

export function useAttachmentGallery(): GalleryItem[] | null {
  return useContext(GalleryContext)
}
