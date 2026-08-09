'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Shared conversations inbox used by the admin Live Chat page (full mode) and
// the frontend agent console (compact mode). Realtime rides the browser's own
// WebSocket to the chat server's ActionCable using the LIMITED pubsub token
// (fetched from the realtime route); a 15s poll of the lc_ mirror is the
// fallback when the socket is down. Typing indicators are receive-only: the
// composer deliberately never emits typing, so customers can't see us drafting.

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

export function useLiveChatRealtime(apiBase: string, onEvent: (event: string, data: unknown) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

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
  const activeIdRef = useRef<number | null>(null)
  activeIdRef.current = activeId
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
  }, [apiBase])

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
  const listPane = (
    <div style={{ borderRight: compact ? 'none' : '1px solid var(--color-border)', overflowY: 'auto', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem' }}>
        {(['open', 'resolved'] as const).map((t) => (
          <button key={t} type="button" className={tab === t ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
            onClick={() => { setTab(t); setActiveId(null); loadList(t) }}>
            {t === 'open' ? 'Open' : 'Resolved'}
          </button>
        ))}
      </div>
      {conversations.length === 0 && (
        <div style={{ padding: '1rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          No {tab} conversations.
        </div>
      )}
      {conversations.map((c) => (
        <button key={c.id} type="button" onClick={() => { setActiveId(c.id); loadThread(c.id) }}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.75rem',
            border: 'none', borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
            background: c.id === activeId ? 'var(--color-bg-subtle)' : 'transparent', color: 'inherit',
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span style={{ fontWeight: c.unreadForAgents > 0 ? 700 : 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.contactName || c.contactEmail || `Visitor #${c.id}`}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{timeLabel(c.lastMessageAt)}</span>
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {typing[c.id] ? <em>typing…</em> : c.lastMessagePreview || ' '}
          </div>
          {c.unreadForAgents > 0 && (
            <span style={{ display: 'inline-block', marginTop: '0.25rem', fontSize: '0.6875rem', fontWeight: 700, background: 'var(--color-accent)', color: '#fff', borderRadius: '999px', padding: '0 0.4rem' }}>
              {c.unreadForAgents}
            </span>
          )}
        </button>
      ))}
    </div>
  )

  const threadPane = active ? (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{active.contactName || active.contactEmail || `Visitor #${active.id}`}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {active.contactEmail ?? 'no email yet'}
            {typeof active.meta?.started_on_page === 'string' ? ` · on ${active.meta.started_on_page}` : ''}
          </div>
        </div>
        {active.status === 'open'
          ? <button type="button" className="btn btn-sm" onClick={() => setStatus('resolve')}>Resolve</button>
          : <button type="button" className="btn btn-sm" onClick={() => setStatus('reopen')}>Reopen</button>}
      </div>
      {typeof active.meta?.pages_this_visit === 'string' && (
        <div style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={active.meta.pages_this_visit}>
          Journey: {active.meta.pages_this_visit}
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {messages.filter((m) => !m.isPrivate).map((m) => (
          <div key={m.id} style={{
            alignSelf: m.senderType === 'contact' ? 'flex-start' : 'flex-end',
            maxWidth: '85%', padding: '0.5rem 0.75rem', borderRadius: '0.75rem', fontSize: '0.875rem',
            background: m.senderType === 'contact' ? 'var(--color-bg-subtle)' : 'var(--color-accent)',
            color: m.senderType === 'contact' ? 'inherit' : '#fff',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {m.content}
            {(m.attachments ?? []).map((a, i) => (
              a.data_url ? (
                a.file_type === 'image'
                  // eslint-disable-next-line @next/next/no-img-element -- external chat-server URL, next/image gains nothing here
                  ? <a key={i} href={a.data_url} target="_blank" rel="noreferrer noopener"><img src={a.thumb_url ?? a.data_url} alt="attachment" style={{ display: 'block', maxWidth: '100%', borderRadius: '0.5rem', marginTop: '0.35rem' }} /></a>
                  : <a key={i} href={a.data_url} target="_blank" rel="noreferrer noopener" style={{ display: 'block', marginTop: '0.35rem', color: 'inherit', textDecoration: 'underline' }}>Attachment</a>
              ) : null
            ))}
            <div style={{ fontSize: '0.6875rem', opacity: 0.7, marginTop: '0.25rem' }}>
              {m.senderName ? `${m.senderName} · ` : ''}{timeLabel(m.createdAt)}
            </div>
          </div>
        ))}
        {typing[active.id] && (
          <div style={{ alignSelf: 'flex-start', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>customer is typing…</div>
        )}
      </div>
      {error && <div className="alert alert-danger" style={{ margin: '0 0.75rem', fontSize: '0.8125rem' }}>{error}</div>}
      {files.length > 0 && (
        <div style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {files.map((f) => f.name).join(', ')}
          <button type="button" className="btn btn-sm" style={{ marginLeft: '0.5rem' }} onClick={() => setFiles([])}>clear</button>
        </div>
      )}
      <div style={{ position: 'relative', display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderTop: '1px solid var(--color-border)' }}>
        {showCanned && canned.length > 0 && (
          <div style={{ position: 'absolute', bottom: '100%', left: '0.75rem', right: '0.75rem', maxHeight: '10rem', overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '0.5rem', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', zIndex: 5 }}>
            {canned.map((c) => (
              <button key={c.id} type="button" onClick={() => { setDraft((d) => d.replace(/\/[a-z0-9_-]*$/i, '') + c.content); setShowCanned(false) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.4rem 0.6rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
                <strong style={{ fontSize: '0.8125rem' }}>/{c.short_code}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.4rem' }}>{c.content.slice(0, 60)}</span>
              </button>
            ))}
          </div>
        )}
        <label className="btn btn-sm" style={{ alignSelf: 'flex-end', cursor: 'pointer' }}>
          📎
          <input type="file" multiple style={{ display: 'none' }}
            onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <textarea
          value={draft}
          rows={compact ? 1 : 2}
          placeholder="Reply… ( / for canned replies )"
          style={{ flex: 1, resize: 'none', fontSize: '0.875rem' }}
          onChange={(e) => {
            setDraft(e.target.value)
            setShowCanned(/(^|\s)\/[a-z0-9_-]*$/i.test(e.target.value))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} disabled={sending} onClick={send}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  ) : (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
      Pick a conversation
    </div>
  )

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: compact ? '1fr' : 'minmax(220px, 300px) 1fr',
      height: compact ? '100%' : 'calc(100vh - 220px)',
      minHeight: '360px',
      border: '1px solid var(--color-border)', borderRadius: '0.5rem', overflow: 'hidden',
      background: 'var(--color-bg)',
    }}>
      {compact && activeId !== null ? (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <button type="button" className="btn btn-sm" style={{ margin: '0.4rem', alignSelf: 'flex-start' }} onClick={() => setActiveId(null)}>← All conversations</button>
          {threadPane}
        </div>
      ) : compact ? listPane : (<>{listPane}{threadPane}</>)}
    </div>
  )
}
