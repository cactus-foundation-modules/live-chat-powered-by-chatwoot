'use client'

import { useCallback, useEffect, useState } from 'react'
import { InboxCore, useLiveChatRealtime } from './InboxCore'

// The frontend answering surface: admins browsing the public site get this
// floating console instead of the customer widget, so a chat can be answered
// without leaving the shop. Same components, same routes as the admin page.
//
// The realtime socket lives HERE, not inside the inbox, so a closed console
// still hears new messages instantly: the badge updates at once and the
// button pulses until it's opened.
export function AgentConsole({ apiBase, position }: { apiBase: string; position: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/admin/conversations?status=open`)
      if (res.ok) {
        const json = await res.json() as { unread: number }
        setUnread(json.unread)
      }
    } catch { /* next poll */ }
  }, [apiBase])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 30_000)
    return () => clearInterval(t)
  }, [poll])

  // Any conversation event refreshes the count immediately - the webhook has
  // usually landed in the mirror by the time the fetch returns, and the 30s
  // poll mops up any race.
  useLiveChatRealtime(apiBase, useCallback(() => { poll() }, [poll]))

  const side = position === 'left' ? { left: '1.25rem' } : { right: '1.25rem' }

  return (
    <>
      <style>{`@keyframes lcPulse { 0%,100% { box-shadow: 0 4px 14px rgba(0,0,0,0.25); } 50% { box-shadow: 0 0 0 10px rgba(220,60,60,0.28), 0 4px 14px rgba(0,0,0,0.25); } }`}</style>
      {open && (
        <div style={{
          position: 'fixed', bottom: '5rem', ...side, zIndex: 2147482001,
          width: 'min(400px, calc(100vw - 2rem))', height: 'min(560px, calc(100vh - 8rem))',
          borderRadius: '0.75rem', overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
        }}>
          <InboxCore apiBase={apiBase} compact onUnread={setUnread} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Live chat agent console - ${unread} unread` : 'Live chat agent console'}
        style={{
          position: 'fixed', bottom: '1.25rem', ...side, zIndex: 2147482001,
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.75rem 1.1rem', borderRadius: '999px', border: 'none',
          background: unread > 0 && !open ? 'var(--color-danger, #c0392b)' : 'var(--color-accent, #1A5F5A)',
          color: '#fff',
          fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          animation: unread > 0 && !open ? 'lcPulse 1.6s ease-in-out infinite' : undefined,
        }}
      >
        🎧 {open ? 'Close' : unread > 0 ? 'New message!' : 'Chats'}
        {unread > 0 && (
          <span style={{ background: '#fff', color: 'var(--color-accent, #1A5F5A)', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, padding: '0 0.45rem' }}>
            {unread}
          </span>
        )}
      </button>
    </>
  )
}
