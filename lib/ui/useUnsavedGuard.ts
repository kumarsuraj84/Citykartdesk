'use client'

import { useEffect } from 'react'

const DEFAULT_MESSAGE = 'You have changes that are not saved. Leave this page and lose them?'

/**
 * Warns before the person loses unsaved work. The browser's own warning only covers closing the tab or
 * reloading; this also covers clicking a link inside the app and the Back button.
 * `dirty` true = there is unsaved work.
 */
export function useUnsavedGuard(dirty: boolean, message: string = DEFAULT_MESSAGE): void {
  useEffect(() => {
    if (!dirty) return

    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }

    // links inside the app (capture phase so it runs before the router sees the click)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin) return
      if (url.pathname === location.pathname && url.search === location.search) return // same page (hash, etc.)
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation() }
    }

    // Back / Forward: the address has already changed when popstate fires. If the person decides to stay, stop the router from
    // following it (capture phase, so this runs first) and put the address back.
    const here = location.href
    const hereState = history.state
    const onPopState = (e: PopStateEvent) => {
      if (window.confirm(message)) return
      e.stopImmediatePropagation()
      history.pushState(hereState, '', here)
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState, true)
    }
  }, [dirty, message])
}
