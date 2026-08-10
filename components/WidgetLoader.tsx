'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CONSENT_CHANGE_EVENT, chatConsentGranted } from '../lib/consent'

// Customer-facing side of the LiveChatWidget block.
//
// Privacy behaviour, in order:
// - Where the site's consent banner carries a live-chat category, the bubble
//   itself does not render until that category is granted. Someone who has not
//   answered the banner yet has no decision recorded, so they see nothing; so
//   does someone who answered and left live chat off. Withdrawing the
//   permission mid-visit takes the bubble away again (and closes an open
//   panel) without waiting for a reload.
// - Nothing chat-related loads until the visitor clicks the bubble. No script,
//   no cookies, no Chatwoot contact. The bubble is a plain button.
// - The page journey (this visit only) is buffered in sessionStorage, on the
//   same permission. It leaves the browser only when a chat is opened.
// - When core Turnstile is configured, opening chat runs a managed challenge
//   (invisible for most people) before the widget config is handed out.

type BootInfo = {
  enabled: boolean
  label: string
  replyTime: string
  position: 'left' | 'right'
  turnstileSiteKey: string | null
  consentGate?: 'allowed' | 'category'
  online?: boolean
}

type BootPayload = {
  serverUrl: string
  websiteToken: string
  position: 'left' | 'right'
  identity?: { identifier: string; identifierHash: string; name?: string; email?: string }
}

// window.__cactusConsent and window.turnstile are declared by core with their
// own types - read them through casts rather than re-declaring.
type ChatwootGlobal = {
  toggle: (state?: 'open' | 'close') => void
  setUser: (identifier: string, props: Record<string, unknown>) => void
  setCustomAttributes: (attrs: Record<string, unknown>) => void
}

function chatwoot(): ChatwootGlobal | undefined {
  return (window as unknown as { $chatwoot?: ChatwootGlobal }).$chatwoot
}

type TurnstileGlobal = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
}

function turnstileGlobal(): TurnstileGlobal | undefined {
  return (window as unknown as { turnstile?: TurnstileGlobal }).turnstile
}

const JOURNEY_KEY = 'cactus-livechat-journey'
const JOURNEY_MAX = 25
// 'open' = the visitor navigated with the chat panel open, so it reopens
// itself on the next page (conversation continuity). 'closed' = they shut it
// deliberately - back to the bubble. Session-scoped like the journey: only a
// visitor already chatting THIS visit ever auto-loads anything.
const ACTIVE_KEY = 'cactus-livechat-active'

function rememberPanelState(state: 'open' | 'closed') {
  try { sessionStorage.setItem(ACTIVE_KEY, state) } catch { /* storage unavailable */ }
}

// The server decides whether chat is consent-gated at all (boot GET's
// consentGate): core defines window.__cactusConsent whether or not the banner
// is enabled, so the client alone cannot tell "no banner" from "not granted".
function chatAllowed(gate: 'allowed' | 'category'): boolean {
  if (typeof window === 'undefined') return false
  if (gate === 'allowed') return true
  return chatConsentGranted()
}

function forgetVisit() {
  try {
    sessionStorage.removeItem(JOURNEY_KEY)
    sessionStorage.removeItem(ACTIVE_KEY)
  } catch { /* storage unavailable - nothing to forget */ }
}

function recordPageView(gate: 'allowed' | 'category') {
  if (!chatAllowed(gate)) return
  try {
    const raw = sessionStorage.getItem(JOURNEY_KEY)
    const list: Array<{ p: string; t: number }> = raw ? JSON.parse(raw) : []
    const path = window.location.pathname
    if (list.length === 0 || list[list.length - 1]?.p !== path) {
      list.push({ p: path, t: Date.now() })
      sessionStorage.setItem(JOURNEY_KEY, JSON.stringify(list.slice(-JOURNEY_MAX)))
    }
  } catch { /* storage unavailable - journey just doesn't happen */ }
}

function readJourney(): string {
  try {
    const raw = sessionStorage.getItem(JOURNEY_KEY)
    if (!raw) return ''
    const list: Array<{ p: string; t: number }> = JSON.parse(raw)
    return list
      .map((entry, i) => {
        const next = list[i + 1]
        const secs = next ? Math.round((next.t - entry.t) / 1000) : null
        return secs !== null ? `${entry.p} (${secs}s)` : entry.p
      })
      .join(' → ')
      .slice(0, 900)
  } catch {
    return ''
  }
}

// Skip the widget's home screen ("Start conversation" / "Continue
// conversation") by nudging its iframe to the conversation route. A src
// assignment that differs only by fragment is an in-place hash navigation -
// no reload - and the widget's router lands straight on the composer.
// Verified against a fresh visitor: #/messages renders the conversation view
// directly with no bounce back to home.
function jumpToMessages() {
  const frame = document.querySelector('.woot-widget-holder iframe') as HTMLIFrameElement | null
  if (frame?.src) frame.src = frame.src.split('#')[0] + '#/messages'
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(s)
  })
}

// Core's consent banner announces every decision on a window event, so the
// grant is read as an external store: no state to fall out of step, and the
// answer is re-read the moment the visitor changes their mind.
function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange)
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange)
}

export function WidgetLoader({ apiBase }: { apiBase: string }) {
  const [info, setInfo] = useState<BootInfo | null>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [panelOpen, setPanelOpen] = useState(false)
  const startedRef = useRef(false)
  const turnstileHost = useRef<HTMLDivElement | null>(null)

  // Chatwoot announces its panel opening/closing; when it closes, our bubble
  // comes back (its own launcher stays hidden), so chat can always be reopened.
  useEffect(() => {
    const onOpen = () => { setPanelOpen(true); rememberPanelState('open') }
    const onClose = () => { setPanelOpen(false); rememberPanelState('closed') }
    window.addEventListener('chatwoot:opened', onOpen)
    window.addEventListener('chatwoot:closed', onClose)
    return () => {
      window.removeEventListener('chatwoot:opened', onOpen)
      window.removeEventListener('chatwoot:closed', onClose)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/widget/boot`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: BootInfo | null) => {
        if (cancelled || !j?.enabled) return
        setInfo(j)
        recordPageView(j.consentGate ?? 'allowed')
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [apiBase])

  const getTurnstileToken = useCallback(async (siteKey: string): Promise<string | undefined> => {
    if (!turnstileGlobal()) {
      await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
    }
    const ts = turnstileGlobal()
    if (!ts || !turnstileHost.current) return undefined
    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 30_000)
      ts.render(turnstileHost.current!, {
        sitekey: siteKey,
        callback: (token: string) => { clearTimeout(timer); resolve(token) },
        'error-callback': () => { clearTimeout(timer); resolve(undefined) },
      })
    })
  }, [])

  const openChat = useCallback(async () => {
    if (startedRef.current) {
      chatwoot()?.toggle('open')
      jumpToMessages()
      setPanelOpen(true)
      rememberPanelState('open')
      return
    }
    if (!info) return
    setState('starting')
    try {
      let turnstileToken: string | undefined
      if (info.turnstileSiteKey) turnstileToken = await getTurnstileToken(info.turnstileSiteKey)

      const res = await fetch(`${apiBase}/widget/boot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnstileToken }),
      })
      if (!res.ok) throw new Error(`boot ${res.status}`)
      const boot = await res.json() as BootPayload

      // Follow the SITE's theme (core sets data-theme on the root and keeps it
      // in step with the toggle/OS). Chatwoot's widget offers 'light' or
      // 'auto' (auto = OS preference), so: site dark -> 'auto' (dark for
      // everyone whose OS agrees, which is nearly everyone who chose dark),
      // site light -> hard 'light'. Read at boot; a mid-visit toggle catches
      // up on the next page.
      const siteIsDark = document.documentElement.getAttribute('data-theme') === 'dark'
      ;(window as unknown as { chatwootSettings?: Record<string, unknown> }).chatwootSettings = {
        hideMessageBubble: true,
        position: boot.position,
        locale: 'en',
        type: 'standard',
        darkMode: siteIsDark ? 'auto' : 'light',
      }

      // The ready listener attaches BEFORE the SDK runs - with warm caches the
      // event can fire almost immediately, and a listener added after run()
      // can miss it, leaving the bubble stuck on "Starting…". The interval is
      // the belt-and-braces fallback for the same race.
      let readied = false
      const onReady = () => {
        if (readied) return
        readied = true
        startedRef.current = true
        if (boot.identity) {
          chatwoot()?.setUser(boot.identity.identifier, {
            identifier_hash: boot.identity.identifierHash,
            name: boot.identity.name,
            email: boot.identity.email,
          })
        }
        const journey = readJourney()
        const attrs: Record<string, unknown> = { started_on_page: window.location.pathname }
        if (journey) attrs.pages_this_visit = journey
        // Contact attributes stick to the person; conversation attributes are
        // what the webhook mirrors into the admin inbox's journey line - set
        // both, and again shortly after in case the conversation is only
        // created once the visitor sends their first message.
        const push = () => {
          chatwoot()?.setCustomAttributes(attrs)
          ;(window as unknown as { $chatwoot?: { setConversationCustomAttributes?: (a: Record<string, unknown>) => void } })
            .$chatwoot?.setConversationCustomAttributes?.(attrs)
        }
        push()
        setTimeout(push, 8000)
        window.addEventListener('chatwoot:on-message', push, { once: true })
        chatwoot()?.toggle('open')
        jumpToMessages()
        setPanelOpen(true)
        rememberPanelState('open')
        setState('ready')
      }

      window.addEventListener('chatwoot:ready', onReady, { once: true })
      // Fallback for a missed ready event - but only once the panel has REAL
      // size. $chatwoot existing alone is not readiness: while the chat
      // server is still booting (it restarts for updates), the SDK global
      // appears but the panel stays 0x0, and trusting it hid the bubble over
      // a blank void.
      const readyPoll = setInterval(() => {
        if (readied) { clearInterval(readyPoll); return }
        const holder = document.querySelector('.woot-widget-holder')
        if (chatwoot() && holder && holder.getBoundingClientRect().height > 50) onReady()
      }, 500)
      // Server unreachable or mid-boot: give up loudly instead of spinning.
      setTimeout(() => {
        clearInterval(readyPoll)
        if (!readied) {
          document.querySelector('.woot-widget-holder')?.remove()
          setState('error')
        }
      }, 45_000)

      await loadScript(`${boot.serverUrl.replace(/\/$/, '')}/packs/js/sdk.js`)
      const sdk = (window as unknown as { chatwootSDK?: { run: (o: { websiteToken: string; baseUrl: string }) => void } }).chatwootSDK
      if (!sdk) throw new Error('chat sdk missing')
      sdk.run({ websiteToken: boot.websiteToken, baseUrl: boot.serverUrl.replace(/\/$/, '') })
    } catch {
      setState('error')
    }
  }, [apiBase, info, getTurnstileToken])

  // Consent, re-read whenever the visitor answers the banner or changes their
  // mind. On a site whose banner carries no live-chat category the server
  // reports gate 'allowed' and this never comes into it.
  const granted = useSyncExternalStore(subscribeConsent, chatConsentGranted, () => false)
  const allowed = (info?.consentGate ?? 'allowed') === 'allowed' || granted

  // Permission withdrawn mid-visit: shut the panel, drop the widget's frame and
  // forget this visit's buffered journey. The already-loaded SDK goes on the
  // next page load; nothing further is sent in the meantime.
  const wasAllowedRef = useRef(true)
  useEffect(() => {
    if (allowed) {
      if (!wasAllowedRef.current && info) recordPageView(info.consentGate ?? 'allowed')
      wasAllowedRef.current = true
      return
    }
    wasAllowedRef.current = false
    if (startedRef.current) {
      chatwoot()?.toggle('close')
      document.querySelector('.woot-widget-holder')?.remove()
      // Back to square one: a visitor who grants the permission again this
      // visit gets the bubble, not a hidden panel that no longer exists. The
      // panel really has closed, so it is announced on the widget's own event
      // - the same one that brings the bubble back after an ordinary close.
      startedRef.current = false
      window.dispatchEvent(new Event('chatwoot:closed'))
    }
    forgetVisit()
  }, [allowed, info])

  // Conversation continuity: a visitor who navigated with the panel open gets
  // it reopened on the new page without another click. Runs once per page.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!info || !allowed || autoOpenedRef.current || startedRef.current || state !== 'idle') return
    let flag: string | null = null
    try { flag = sessionStorage.getItem(ACTIVE_KEY) } catch { /* storage unavailable */ }
    if (flag === 'open') {
      autoOpenedRef.current = true
      openChat()
    }
  }, [info, allowed, state, openChat])

  // No bubble at all until chat is allowed: a visitor who has not answered the
  // banner has no decision recorded, and one who declined live chat has a
  // recorded no. Both land here.
  if (!info || !allowed) return null

  const side = info.position === 'left' ? { left: '1.25rem' } : { right: '1.25rem' }
  const away = info.online === false
  const bubbleLabel = away ? 'Leave us a message' : info.label
  const bubbleTitle = away ? 'We are away right now - leave a message and we will get back to you' : info.replyTime

  return (
    <>
      <div ref={turnstileHost} style={{ position: 'fixed', bottom: '-9999px' }} aria-hidden="true" />
      {!panelOpen && (
        <button
          type="button"
          onClick={state === 'error' ? () => window.location.reload() : openChat}
          disabled={state === 'starting'}
          aria-label={bubbleLabel}
          title={bubbleTitle}
          style={{
            position: 'fixed', bottom: '1.25rem', ...side, zIndex: 2147482000,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.75rem 1.1rem', borderRadius: '999px', border: 'none',
            background: 'var(--color-accent, #1A5F5A)', color: '#fff',
            fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {state === 'starting' ? 'Starting…' : state === 'error' ? 'Chat unavailable - tap to retry' : bubbleLabel}
        </button>
      )}
    </>
  )
}
