'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import RobotAvatar from './RobotAvatar'
import { ASSISTANT_NOTICE } from '@/lib/ckoneai/notice'
import './assistant.css'

// The "Ask CK Desk" bot button at the bottom right of every page, the same button and window as the CKOneAI assistant in CityKart Pulse (look: ./assistant.css).
// A click opens the chat window with the CKOneAI chat page (served through this app at /ckoneai-ui, same address, so no second login). The chat page is loaded only the first time the
// window is opened (nothing calls CKOneAI while a page is merely viewed); minimise keeps it, close removes it (the conversation itself is kept by CKOneAI under History).
// Only people the server lets in get this component (app/(app)/layout.tsx); it is not shown on the full-page version.
//
// The chat page tells its parent what it is doing; only messages from this window's own frame and own address are read:
//   ckoneai:ready, ckoneai:status {state: online | offline}, ckoneai:assistant-message {id} (a reply finished in THIS session), ckoneai:escape.
export const ASSISTANT_FRAME_SRC = '/ckoneai-ui?embed=1&bridge=ckdesk'
export const ASSISTANT_TITLE = 'Ask CK Desk'
export { ASSISTANT_NOTICE }
export type AssistantStatus = 'connecting' | 'online' | 'offline'
const STATUS_TEXT: Record<AssistantStatus, string> = { connecting: 'Connecting...', online: 'Online', offline: 'Offline' }

export function AssistantLauncher() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)           // the chat page exists (first open happened, window not closed with X)
  const [reach, setReach] = useState<'unknown' | 'up' | 'down'>('unknown')
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [frameState, setFrameState] = useState<'online' | 'offline' | null>(null)
  const [ready, setReady] = useState(false)
  const [unread, setUnread] = useState(0)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const panel = useRef<HTMLElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const seen = useRef<Set<string>>(new Set())
  const openRef = useRef(false)

  const status: AssistantStatus =
    reach === 'down' || frameState === 'offline' ? 'offline'
      : reach === 'up' && frameLoaded && (frameState === 'online' || (frameState === null && ready)) ? 'online'
        : 'connecting'

  const minimise = useCallback(() => { setOpen(false); button.current?.focus() }, [])
  const closeAndForget = useCallback(() => {
    setOpen(false); setLoaded(false); setReach('unknown'); setFrameLoaded(false); setFrameState(null); setReady(false); button.current?.focus()
  }, [])

  const toggle = () => {
    if (open) { minimise(); return }
    setLoaded(true); setOpen(true)
  }

  // a plain reachability check the first time the window is created (not at page load): the page is served by this app and answers 502 / 503 when the assistant cannot be reached
  useEffect(() => {
    if (!loaded || reach !== 'unknown') return
    let live = true
    fetch(ASSISTANT_FRAME_SRC, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
      .then((r) => { if (live) setReach(r.status >= 500 ? 'down' : 'up') })
      .catch(() => { if (live) setReach('down') })
    return () => { live = false }
  }, [loaded, reach])

  useEffect(() => { openRef.current = open }, [open])   // read by the message and visibility listeners below

  // the open window takes focus; Esc closes (minimises) it and returns focus to the button
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') minimise() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, minimise])

  // unread replies: counted while the window is closed, minimised or the tab is hidden; cleared when the window is open and visible
  useEffect(() => {
    const clearIfSeen = () => { if (openRef.current && !document.hidden) { seen.current.clear(); setUnread(0) } }
    clearIfSeen()
    document.addEventListener('visibilitychange', clearIfSeen)
    return () => document.removeEventListener('visibilitychange', clearIfSeen)
  }, [open])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !frame.current || e.source !== frame.current.contentWindow) return
      const d = e.data as { type?: unknown; state?: unknown; status?: unknown; id?: unknown } | null
      if (!d || typeof d !== 'object' || typeof d.type !== 'string') return
      if (d.type === 'ckoneai:escape') minimise()
      else if (d.type === 'ckoneai:ready') setReady(true)
      else if (d.type === 'ckoneai:status') { const v = d.state ?? d.status; setFrameState(v === 'offline' ? 'offline' : v === 'online' ? 'online' : null) }
      else if (d.type === 'ckoneai:assistant-message') {
        if (!openRef.current || document.hidden) {
          const id = typeof d.id === 'string' || typeof d.id === 'number' ? String(d.id) : `n${seen.current.size}`
          seen.current.add(id)
          setUnread(seen.current.size)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [minimise])

  // phones: the window is full screen and follows the visible height (on-screen keyboard)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const set = () => document.documentElement.style.setProperty('--ai-vvh', `${vv.height}px`)
    set()
    vv.addEventListener('resize', set)
    return () => { vv.removeEventListener('resize', set); document.documentElement.style.removeProperty('--ai-vvh') }
  }, [])

  if (pathname === '/ckoneai' || pathname.startsWith('/ckoneai/')) return null

  const label = open ? `Close ${ASSISTANT_TITLE}` : unread > 0 ? `Open ${ASSISTANT_TITLE}, ${unread} unread ${unread === 1 ? 'reply' : 'replies'}` : `Open ${ASSISTANT_TITLE}`

  return (
    <div className="ai-root" data-state={open ? 'open' : 'closed'}>
      {loaded && (
        <section
          id="ckoneai-window"
          ref={panel}
          className="ai-panel"
          role="dialog"
          aria-label={ASSISTANT_TITLE}
          aria-hidden={!open}
          data-open={open}
          tabIndex={-1}
        >
          <header className="ai-head">
            <span className="ai-head__badge"><RobotAvatar size={30} /></span>
            <span className="ai-head__titles">
              <span className="ai-head__title">{ASSISTANT_TITLE}</span>
              <span className="ai-head__status" data-status={status} role="status"><i aria-hidden="true" />{STATUS_TEXT[status]}</span>
            </span>
            <a className="ai-head__btn" href="/ckoneai" target="_blank" rel="noopener" title="Open on a full page" aria-label="Open on a full page in a new tab">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </a>
            <button type="button" className="ai-head__btn" onClick={minimise} title="Minimise" aria-label="Minimise"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></button>
            <button type="button" className="ai-head__btn" onClick={closeAndForget} title="Close" aria-label="Close and end this chat window"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></button>
          </header>
          <p className="ai-notice">{ASSISTANT_NOTICE}</p>
          {status === 'offline' && <p className="ai-offline-note">The assistant is not reachable right now. The rest of CK Desk is not affected. Please try again in a little while.</p>}
          <iframe ref={frame} title={ASSISTANT_TITLE} src={ASSISTANT_FRAME_SRC} className="ai-frame" allow="clipboard-write" onLoad={() => setFrameLoaded(true)} />
        </section>
      )}
      <button ref={button} type="button" className="ai-launcher" data-open={open} onClick={toggle} aria-label={label} aria-expanded={open} aria-haspopup="dialog" aria-controls="ckoneai-window">
        <span className="ai-launcher__label" aria-hidden="true">
          <span className="ai-launcher__text"><strong>{ASSISTANT_TITLE}</strong><span>Tickets, approvals, SLA</span></span>
          <svg className="ai-launcher__arrow" viewBox="0 0 24 24" width="18" height="18"><path d="M5 12h13m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="ai-launcher__icon">
          <span className="ai-launcher__robot"><RobotAvatar size={42} /></span>
          <svg className="ai-launcher__close" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </span>
        {unread > 0 && !open && <span className="ai-launcher__badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </div>
  )
}
