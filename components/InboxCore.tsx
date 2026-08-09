'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Shared conversations inbox used by the admin Live Chat page (full mode) and
// the frontend agent console (compact mode). Realtime rides the browser's own
// WebSocket to the chat server's ActionCable using the LIMITED pubsub token
// (fetched from the realtime route); a 15s poll of the lc_ mirror is the
// fallback when the socket is down. Typing indicators are receive-only: the
// composer deliberately never emits typing, so customers can't see us drafting.
//
// Styling deliberately mirrors the customer-facing Chatwoot widget (sealed
// white card, brand-colour header and agent bubbles) so the two faces of the
// same conversation look like one product. The card is self-contained and
// mode-independent, same as the widget it matches; the brand colour rides
// --color-accent with the widget's own default as fallback.

export type Conversation = {
  id: number
  contactEmail: string | null
  contactName: string | null
  status: string
  assigneeName: string | null
  unreadForAgents: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  meta: Record<string, unknown> | null
}

export type Message = {
  id: number
  conversationId: number
  senderType: string
  senderName: string | null
  content: string | null
  attachments: Array<{ data_url?: string; file_type?: string; thumb_url?: string }> | null
  isPrivate: boolean
  createdAt: string
}

type Canned = { id: number; short_code: string; content: string }

function timeLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function initials(c: Conversation): string {
  const source = c.contactName || c.contactEmail || `#${c.id}`
  const parts = source.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '#') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function useLiveChatRealtime(apiBase: string, onEvent: (event: string, data: unknown) => void) {
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent }, [onEvent])

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      try {
        const res = await fetch(`${apiBase}/admin/realtime`)
        if (!res.ok) return
        const { serverUrl, pubsubToken } = await res.json() as { serverUrl: string; pubsubToken: string }
        if (closed) return
        const wsUrl = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/cable'
        ws = new WebSocket(wsUrl)
        ws.onopen = () => {
          ws?.send(JSON.stringify({
            command: 'subscribe',
            identifier: JSON.stringify({ channel: 'RoomChannel', pubsub_token: pubsubToken }),
          }))
        }
        ws.onmessage = (msg) => {
          try {
            const parsed = JSON.parse(msg.data as string)
            if (parsed.type === 'ping' || parsed.type === 'welcome' || parsed.type === 'confirm_subscription') return
            const event = parsed.message?.event
            if (event) onEventRef.current(event, parsed.message.data)
          } catch { /* non-JSON frame */ }
        }
        ws.onclose = () => {
          if (!closed) retry = setTimeout(connect, 10_000)
        }
      } catch {
        if (!closed) retry = setTimeout(connect, 15_000)
      }
    }

    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [apiBase])
}

const STYLES = `
.lc-card { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #fff; color: #1f2933; font-size: 0.875rem; border-radius: inherit; overflow: hidden; }
.lc-card *, .lc-card *::before, .lc-card *::after { box-sizing: border-box; }
.lc-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.85rem 1rem; background: var(--color-accent, #1A5F5A); color: #fff; flex-shrink: 0; }
.lc-head-title { font-weight: 700; font-size: 0.9375rem; line-height: 1.2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-head-sub { font-size: 0.71875rem; opacity: 0.85; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-avail { margin-left: auto; display: flex; align-items: center; gap: 0.35rem; border: 1px solid rgba(255,255,255,0.45); background: rgba(255,255,255,0.12); color: #fff; border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.71875rem; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.lc-avail:disabled { opacity: 0.6; cursor: default; }
.lc-avail .lc-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: #9ca3af; }
.lc-avail.lc-on .lc-dot { background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,0.9); }
.lc-tabs { display: flex; gap: 0.3rem; padding: 0.6rem 0.75rem; border-bottom: 1px solid #eceff3; flex-shrink: 0; background: #fff; }
.lc-tab { border: none; background: #f1f4f7; color: #52606d; border-radius: 999px; padding: 0.3rem 0.85rem; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.lc-tab.lc-active { background: var(--color-accent, #1A5F5A); color: #fff; }
.lc-body { display: flex; flex: 1; min-height: 0; min-width: 0; }
.lc-list { overflow-y: auto; min-width: 0; flex: 1; background: #fff; }
.lc-row { display: flex; align-items: center; gap: 0.65rem; width: 100%; text-align: left; padding: 0.65rem 0.85rem; border: none; border-bottom: 1px solid #f1f4f7; background: transparent; cursor: pointer; color: inherit; }
.lc-row:hover { background: #f7fafc; }
.lc-row.lc-active { background: #eef4f3; }
.lc-ava { width: 2.2rem; height: 2.2rem; border-radius: 999px; background: color-mix(in srgb, var(--color-accent, #1A5F5A) 14%, #fff); color: var(--color-accent, #1A5F5A); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8125rem; flex-shrink: 0; }
.lc-row-main { min-width: 0; flex: 1; }
.lc-row-top { display: flex; justify-content: space-between; gap: 0.5rem; align-items: baseline; }
.lc-row-name { font-weight: 600; font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.lc-row-time { font-size: 0.6875rem; color: #7b8794; flex-shrink: 0; }
.lc-row-preview { font-size: 0.75rem; color: #7b8794; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-unread { background: var(--color-accent, #1A5F5A); color: #fff; border-radius: 999px; font-size: 0.65rem; font-weight: 700; padding: 0.05rem 0.4rem; flex-shrink: 0; }
.lc-empty { padding: 2rem 1rem; color: #7b8794; font-size: 0.8125rem; text-align: center; }
.lc-thread { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; max-width: 100%; overflow: hidden; background: #f7f9fb; }
.lc-thread-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.85rem; background: #fff; border-bottom: 1px solid #eceff3; flex-shrink: 0; }
.lc-thread-who { min-width: 0; flex: 1; }
.lc-thread-name { font-weight: 700; font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-thread-sub { font-size: 0.6875rem; color: #7b8794; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-resolve { border: 1px solid #d9e2ec; background: #fff; color: #3e4c59; border-radius: 999px; padding: 0.3rem 0.75rem; font-size: 0.71875rem; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.lc-resolve:hover { border-color: var(--color-accent, #1A5F5A); color: var(--color-accent, #1A5F5A); }
.lc-journey { padding: 0.3rem 0.85rem; font-size: 0.6875rem; color: #7b8794; background: #fff; border-bottom: 1px solid #eceff3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: 100%; flex-shrink: 0; }
.lc-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.45rem; }
.lc-bub { max-width: 82%; padding: 0.5rem 0.8rem; font-size: 0.8125rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.lc-bub.lc-them { align-self: flex-start; background: #fff; border: 1px solid #e4e9ef; border-radius: 4px 14px 14px 14px; }
.lc-bub.lc-us { align-self: flex-end; background: var(--color-accent, #1A5F5A); color: #fff; border-radius: 14px 4px 14px 14px; }
.lc-bub-meta { font-size: 0.625rem; opacity: 0.65; margin-top: 0.25rem; }
.lc-bub img { display: block; max-width: 100%; border-radius: 0.5rem; margin-top: 0.35rem; }
.lc-bub a { color: inherit; }
.lc-typing { align-self: flex-start; font-size: 0.75rem; color: #7b8794; padding: 0.2rem 0.4rem; }
.lc-typing i { font-style: normal; animation: lcBlink 1.2s infinite; }
@keyframes lcBlink { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }
.lc-compose-wrap { background: #fff; border-top: 1px solid #eceff3; padding: 0.6rem 0.75rem; position: relative; flex-shrink: 0; }
.lc-compose { display: flex; align-items: flex-end; gap: 0.45rem; background: #f1f4f7; border-radius: 1.1rem; padding: 0.35rem 0.45rem 0.35rem 0.7rem; }
.lc-compose textarea { flex: 1; border: none; background: transparent; resize: none; font: inherit; font-size: 0.8125rem; color: #1f2933; outline: none; padding: 0.35rem 0; min-width: 0; max-height: 6.5rem; }
.lc-icon-btn { border: none; background: transparent; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0.4rem; border-radius: 999px; color: #52606d; flex-shrink: 0; display: flex; align-items: center; }
.lc-icon-btn:hover { background: #e4e9ef; }
.lc-send { border: none; cursor: pointer; background: var(--color-accent, #1A5F5A); color: #fff; border-radius: 999px; width: 2.1rem; height: 2.1rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lc-send:disabled { opacity: 0.5; cursor: default; }
.lc-files { padding: 0.25rem 0.85rem 0; font-size: 0.71875rem; color: #52606d; display: flex; align-items: center; gap: 0.4rem; background: #fff; }
.lc-canned { position: absolute; bottom: 100%; left: 0.75rem; right: 0.75rem; max-height: 11rem; overflow-y: auto; background: #fff; border: 1px solid #e4e9ef; border-radius: 0.7rem; box-shadow: 0 10px 26px rgba(15,30,40,0.16); z-index: 6; margin-bottom: 0.4rem; }
.lc-canned button { display: block; width: 100%; text-align: left; padding: 0.45rem 0.7rem; border: none; background: transparent; cursor: pointer; color: inherit; }
.lc-canned button:hover { background: #f1f4f7; }
.lc-alert { margin: 0.4rem 0.85rem; padding: 0.4rem 0.6rem; border-radius: 0.5rem; background: #fdecea; color: #b03026; font-size: 0.75rem; }
.lc-back { border: none; background: transparent; color: #fff; cursor: pointer; font-size: 1rem; padding: 0.15rem 0.3rem; margin-left: -0.3rem; flex-shrink: 0; }
.lc-pick { flex: 1; display: flex; align-items: center; justify-content: center; color: #7b8794; font-size: 0.8125rem; background: #f7f9fb; }

/* Dark mode rides the site's own data-theme attribute (core keeps it in step
   with the toggle and the OS). Header and agent bubbles stay brand-coloured -
   they already read in both modes - everything white goes to deep slate. */
[data-theme="dark"] .lc-card { background: #14181d; color: #dde3ea; }
[data-theme="dark"] .lc-tabs { background: #14181d; border-bottom-color: #262d35; }
[data-theme="dark"] .lc-tab { background: #222932; color: #aab4bf; }
[data-theme="dark"] .lc-tab.lc-active { background: var(--color-accent, #1A5F5A); color: #fff; }
[data-theme="dark"] .lc-list { background: #14181d; }
[data-theme="dark"] .lc-row { border-bottom-color: #20262d; }
[data-theme="dark"] .lc-row:hover { background: #1b2129; }
[data-theme="dark"] .lc-row.lc-active { background: #1e2a28; }
[data-theme="dark"] .lc-ava { background: color-mix(in srgb, var(--color-accent, #1A5F5A) 30%, #14181d); color: #9fd8d0; }
[data-theme="dark"] .lc-row-time, [data-theme="dark"] .lc-row-preview, [data-theme="dark"] .lc-empty, [data-theme="dark"] .lc-typing { color: #8b96a2; }
[data-theme="dark"] .lc-thread { background: #0f1317; }
[data-theme="dark"] .lc-thread-head { background: #14181d; border-bottom-color: #262d35; }
[data-theme="dark"] .lc-thread-sub { color: #8b96a2; }
[data-theme="dark"] .lc-resolve { background: #14181d; border-color: #313a44; color: #c3ccd5; }
[data-theme="dark"] .lc-journey { background: #14181d; border-bottom-color: #262d35; color: #8b96a2; }
[data-theme="dark"] .lc-bub.lc-them { background: #1d242c; border-color: #2b333d; }
[data-theme="dark"] .lc-compose-wrap { background: #14181d; border-top-color: #262d35; }
[data-theme="dark"] .lc-compose { background: #222932; }
[data-theme="dark"] .lc-compose textarea { color: #dde3ea; }
[data-theme="dark"] .lc-icon-btn { color: #aab4bf; }
[data-theme="dark"] .lc-icon-btn:hover { background: #2b333d; }
[data-theme="dark"] .lc-canned { background: #1a2027; border-color: #2b333d; }
[data-theme="dark"] .lc-canned button:hover { background: #222932; }
[data-theme="dark"] .lc-files { background: #14181d; color: #aab4bf; }
[data-theme="dark"] .lc-alert { background: #3a1f1d; color: #f1a9a0; }
[data-theme="dark"] .lc-pick { background: #0f1317; color: #8b96a2; }
`

export function InboxCore({ apiBase, compact, onUnread }: {
  apiBase: string
  compact?: boolean
  onUnread?: (n: number) => void
}) {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState<Record<number, boolean>>({})
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [canned, setCanned] = useState<Canned[]>([])
  const [showCanned, setShowCanned] = useState(false)
  const [availability, setAvailability] = useState<'online' | 'offline' | 'busy' | null>(null)
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const activeIdRef = useRef<number | null>(null)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const loadList = useCallback(async (which: 'open' | 'resolved' = tab) => {
    try {
      const res = await fetch(`${apiBase}/admin/conversations?status=${which}`)
      if (!res.ok) return
      const json = await res.json() as { conversations: Conversation[]; unread: number }
      setConversations(json.conversations)
      onUnread?.(json.unread)
    } catch { /* poll again later */ }
  }, [apiBase, tab, onUnread])

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${apiBase}/admin/conversations/${id}`)
      if (!res.ok) return
      const json = await res.json() as { messages: Message[] }
      setMessages(json.messages)
      fetch(`${apiBase}/admin/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }).catch(() => {})
    } catch { /* transient */ }
  }, [apiBase])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    const t = setInterval(() => {
      loadList()
      if (activeIdRef.current) loadThread(activeIdRef.current)
    }, 15_000)
    return () => clearInterval(t)
  }, [loadList, loadThread])

  useEffect(() => {
    fetch(`${apiBase}/admin/canned`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.canned) setCanned(j.canned)
    }).catch(() => {})
    fetch(`${apiBase}/admin/availability`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j?.availability) setAvailability(j.availability)
    }).catch(() => {})
  }, [apiBase])

  async function toggleAvailability() {
    const next = availability === 'online' ? 'offline' : 'online'
    setAvailabilityBusy(true)
    try {
      const res = await fetch(`${apiBase}/admin/availability`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ availability: next }),
      })
      if (res.ok) setAvailability(next)
    } catch { /* stays as-is */ } finally {
      setAvailabilityBusy(false)
    }
  }

  useLiveChatRealtime(apiBase, useCallback((event: string, data: unknown) => {
    const payload = data as { conversation?: { id?: number }; conversation_id?: number; id?: number } | undefined
    const convId = payload?.conversation?.id ?? payload?.conversation_id
    if (event === 'conversation.typing_on' && convId) {
      setTyping((t) => ({ ...t, [convId]: true }))
      setTimeout(() => setTyping((t) => ({ ...t, [convId]: false })), 12_000)
      return
    }
    if (event === 'conversation.typing_off' && convId) {
      setTyping((t) => ({ ...t, [convId]: false }))
      return
    }
    // Anything else that names a conversation: refresh. Cheap and correct.
    loadList()
    if (convId && convId === activeIdRef.current) loadThread(convId)
  }, [loadList, loadThread]))

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function send() {
    if (!activeId || (!draft.trim() && files.length === 0) || sending) return
    setSending(true)
    setError('')
    try {
      const fd = new FormData()
      fd.set('content', draft)
      for (const f of files) fd.append('files', f)
      const res = await fetch(`${apiBase}/admin/conversations/${activeId}/messages`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Send failed')
      setDraft('')
      setFiles([])
      loadThread(activeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function setStatus(action: 'resolve' | 'reopen') {
    if (!activeId) return
    await fetch(`${apiBase}/admin/conversations/${activeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => {})
    loadList()
    loadThread(activeId)
  }

  const active = conversations.find((c) => c.id === activeId) ?? null
  const showList = !compact || activeId === null
  const showThread = !compact || activeId !== null
  const pageLine = active && typeof active.meta?.started_on_page === 'string'
    ? active.meta.started_on_page
    : active && typeof active.meta?.referer === 'string'
      ? String(active.meta.referer).replace(/^https?:\/\/[^/]+/, '') || '/'
      : null

  const header = (
    <div className="lc-head">
      {compact && activeId !== null && (
        <button type="button" className="lc-back" aria-label="All conversations" onClick={() => setActiveId(null)}>←</button>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="lc-head-title">{compact && active ? (active.contactName || active.contactEmail || `Visitor #${active.id}`) : 'Live Chat'}</div>
        <div className="lc-head-sub">
          {compact && active
            ? (active.contactEmail ?? 'no email yet') + (pageLine ? ` · on ${pageLine}` : '')
            : availability === 'online' ? 'You are online' : availability === null ? '…' : 'You are away'}
        </div>
      </div>
      <button type="button" className={`lc-avail${availability === 'online' ? ' lc-on' : ''}`}
        disabled={availabilityBusy || availability === null}
        onClick={toggleAvailability}
        title={availability === 'online' ? 'Customers see chat as available. Click to go offline.' : 'Customers see chat as away. Click to go online.'}>
        <span className="lc-dot" aria-hidden="true" />
        {availability === null ? '…' : availability === 'online' ? 'Online' : 'Offline'}
      </button>
    </div>
  )

  const listPane = (
    <div className="lc-list" style={!compact ? { flex: 'unset', width: 'min(300px, 40%)', borderRight: '1px solid #eceff3' } : undefined}>
      {conversations.length === 0 && <div className="lc-empty">No {tab} conversations.</div>}
      {conversations.map((c) => (
        <button key={c.id} type="button" className={`lc-row${c.id === activeId ? ' lc-active' : ''}`}
          onClick={() => { setActiveId(c.id); loadThread(c.id) }}>
          <span className="lc-ava" aria-hidden="true">{initials(c)}</span>
          <span className="lc-row-main">
            <span className="lc-row-top">
              <span className="lc-row-name" style={c.unreadForAgents > 0 ? { fontWeight: 700 } : undefined}>
                {c.contactName || c.contactEmail || `Visitor #${c.id}`}
              </span>
              <span className="lc-row-time">{timeLabel(c.lastMessageAt)}</span>
            </span>
            <span className="lc-row-preview">
              {typing[c.id] ? <em>typing…</em> : c.lastMessagePreview || ' '}
            </span>
          </span>
          {c.unreadForAgents > 0 && <span className="lc-unread">{c.unreadForAgents}</span>}
        </button>
      ))}
    </div>
  )

  const threadPane = active ? (
    <div className="lc-thread">
      {!compact && (
        <div className="lc-thread-head">
          <span className="lc-ava" aria-hidden="true">{initials(active)}</span>
          <div className="lc-thread-who">
            <div className="lc-thread-name">{active.contactName || active.contactEmail || `Visitor #${active.id}`}</div>
            <div className="lc-thread-sub">{active.contactEmail ?? 'no email yet'}{pageLine ? ` · on ${pageLine}` : ''}</div>
          </div>
          <button type="button" className="lc-resolve" onClick={() => setStatus(active.status === 'open' ? 'resolve' : 'reopen')}>
            {active.status === 'open' ? '✓ Resolve' : 'Reopen'}
          </button>
        </div>
      )}
      {compact && (
        <div className="lc-thread-head" style={{ padding: '0.4rem 0.85rem' }}>
          <button type="button" className="lc-resolve" style={{ marginLeft: 'auto' }} onClick={() => setStatus(active.status === 'open' ? 'resolve' : 'reopen')}>
            {active.status === 'open' ? '✓ Resolve' : 'Reopen'}
          </button>
        </div>
      )}
      {typeof active.meta?.pages_this_visit === 'string' && (
        <div className="lc-journey" title={active.meta.pages_this_visit}>
          🧭 {active.meta.pages_this_visit}
        </div>
      )}
      <div ref={scrollRef} className="lc-msgs">
        {messages.filter((m) => !m.isPrivate).map((m) => (
          <div key={m.id} className={`lc-bub ${m.senderType === 'contact' ? 'lc-them' : 'lc-us'}`}>
            {m.content}
            {(m.attachments ?? []).map((a, i) => (
              a.data_url ? (
                a.file_type === 'image'
                  // eslint-disable-next-line @next/next/no-img-element -- external chat-server URL, next/image gains nothing here
                  ? <a key={i} href={a.data_url} target="_blank" rel="noreferrer noopener"><img src={a.thumb_url ?? a.data_url} alt="attachment" /></a>
                  : <a key={i} href={a.data_url} target="_blank" rel="noreferrer noopener" style={{ display: 'block', marginTop: '0.35rem', textDecoration: 'underline' }}>📎 Attachment</a>
              ) : null
            ))}
            <div className="lc-bub-meta">
              {m.senderName ? `${m.senderName} · ` : ''}{timeLabel(m.createdAt)}
            </div>
          </div>
        ))}
        {typing[active.id] && (
          <div className="lc-typing">customer is typing<i>…</i></div>
        )}
      </div>
      {error && <div className="lc-alert">{error}</div>}
      {files.length > 0 && (
        <div className="lc-files">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            📎 {files.map((f) => f.name).join(', ')}
          </span>
          <button type="button" className="lc-icon-btn" aria-label="Clear attachments" onClick={() => setFiles([])}>✕</button>
        </div>
      )}
      <div className="lc-compose-wrap">
        {showCanned && canned.length > 0 && (
          <div className="lc-canned">
            {canned.map((c) => (
              <button key={c.id} type="button" onClick={() => { setDraft((d) => d.replace(/\/[a-z0-9_-]*$/i, '') + c.content); setShowCanned(false) }}>
                <strong style={{ fontSize: '0.8125rem' }}>/{c.short_code}</strong>
                <span style={{ fontSize: '0.75rem', color: '#7b8794', marginLeft: '0.4rem' }}>{c.content.slice(0, 56)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="lc-compose">
          <label className="lc-icon-btn" title="Attach files" style={{ cursor: 'pointer' }}>
            📎
            <input type="file" multiple style={{ display: 'none' }}
              onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
          <textarea
            value={draft}
            rows={1}
            placeholder="Reply… ( / for canned replies )"
            onChange={(e) => {
              setDraft(e.target.value)
              setShowCanned(/(^|\s)\/[a-z0-9_-]*$/i.test(e.target.value))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
          />
          <button type="button" className="lc-send" aria-label="Send" disabled={sending} onClick={send}>
            {sending ? '…' : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="lc-pick">Pick a conversation</div>
  )

  return (
    <div className="lc-card" style={!compact ? { height: 'calc(100vh - 220px)', minHeight: '400px', border: '1px solid var(--color-border, #e4e9ef)', borderRadius: '0.9rem' } : undefined}>
      <style>{STYLES}</style>
      {header}
      {showList && !(compact && activeId !== null) && (
        <div className="lc-tabs">
          {(['open', 'resolved'] as const).map((t) => (
            <button key={t} type="button" className={`lc-tab${tab === t ? ' lc-active' : ''}`}
              onClick={() => { setTab(t); setActiveId(null); loadList(t) }}>
              {t === 'open' ? 'Open' : 'Resolved'}
            </button>
          ))}
        </div>
      )}
      <div className="lc-body">
        {showList && listPane}
        {showThread && threadPane}
      </div>
    </div>
  )
}
