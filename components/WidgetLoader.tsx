'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Customer-facing side of the LiveChatWidget block.
//
// Privacy behaviour, in order:
// - Nothing chat-related loads until the visitor clicks the bubble. No script,
//   no cookies, no Chatwoot contact. The bubble is a plain button.
// - The page journey (this visit only) is buffered in sessionStorage, and only
//   while allowed: either the site runs no consent banner, or the "live-chat"
//   category is granted. It leaves the browser only when a chat is opened.
// - When core Turnstile is configured, opening chat runs a managed challenge
//   (invisible for most people) before the widget config is handed out.

type BootInfo = {
  enabled: boolean
  label: string
  replyTime: string
  position: 'left' | 'right'
  turnstileSiteKey: string | null
  journeyGate?: 'allowed' | 'category'
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

function consentMap(): Record<string, boolean> | undefined {
  return (window as unknown as { __cactusConsent?: Record<string, boolean> }).__cactusConsent
}

type TurnstileGlobal = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
}

function turnstileGlobal(): TurnstileGlobal | undefined {
  return (window as unknown as { turnstile?: TurnstileGlobal }).turnstile
}

const JOURNEY_KEY = 'cactus-livechat-journey'
const JOURNEY_MAX = 25

// The server decides whether the journey buffer is consent-gated (boot GET's
// journeyGate): core defines window.__cactusConsent whether or not the banner
// is enabled, so the client alone cannot tell "no banner" from "not granted".
function journeyAllowed(gate: 'allowed' | 'category'): boolean {
  if (typeof window === 'undefined') return false
  if (gate === 'allowed') return true
  return consentMap()?.['live-chat'] === true
}

function recordPageView(gate: 'allowed' | 'category') {
  if (!journeyAllowed(gate)) return
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

export function WidgetLoader({ apiBase }: { apiBase: string }) {
  const [info, setInfo] = useState<BootInfo | null>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [panelOpen, setPanelOpen] = useState(false)
  const startedRef = useRef(false)
  const turnstileHost = useRef<HTMLDivElement | null>(null)

  // Chatwoot announces its panel opening/closing; when it closes, our bubble
  // comes back (its own launcher stays hidden), so chat can always be reopened.
  useEffect(() => {
    const onOpen = () => setPanelOpen(true)
    const onClose = () => setPanelOpen(false)
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
        recordPageView(j.journeyGate ?? 'allowed')
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
      setPanelOpen(true)
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

      ;(window as unknown as { chatwootSettings?: Record<string, unknown> }).chatwootSettings = {
        hideMessageBubble: true,
        position: boot.position,
        locale: 'en',
        type: 'standard',
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
        setPanelOpen(true)
        setState('ready')
      }

      window.addEventListener('chatwoot:ready', onReady, { once: true })
      const readyPoll = setInterval(() => {
        if (readied) { clearInterval(readyPoll); return }
        if (chatwoot()) onReady()
      }, 500)
      setTimeout(() => clearInterval(readyPoll), 60_000)

      await loadScript(`${boot.serverUrl.replace(/\/$/, '')}/packs/js/sdk.js`)
      const sdk = (window as unknown as { chatwootSDK?: { run: (o: { websiteToken: string; baseUrl: string }) => void } }).chatwootSDK
      if (!sdk) throw new Error('chat sdk missing')
      sdk.run({ websiteToken: boot.websiteToken, baseUrl: boot.serverUrl.replace(/\/$/, '') })
    } catch {
      setState('error')
    }
  }, [apiBase, info, getTurnstileToken])

  if (!info) return null

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
          onClick={openChat}
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
          {state === 'starting' ? 'Starting…' : state === 'error' ? 'Chat unavailable' : bubbleLabel}
        </button>
      )}
    </>
  )
}
