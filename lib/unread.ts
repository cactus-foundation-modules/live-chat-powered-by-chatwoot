// The chat's unread count, shared between whatever knows it (the visitor widget
// or the staff console) and whatever shows it (the Mobile Bar's chat cell).
//
// Neither side imports the other: the knower publishes on a window event, the
// shower reads it as an external store. Kept in sessionStorage too, so a count
// the visitor has not looked at yet survives the next page - where the chat's
// own frame may not be loaded to tell us again.
//
// Plain module, no 'use client': the value and event name are read from
// client components only, but a shared constant in a directive file becomes a
// throwing proxy the moment anything server-side touches it.

export const LIVE_CHAT_UNREAD_EVENT = 'cactus-livechat:unread'

const UNREAD_KEY = 'cactus-livechat-unread'

// Memory is the source of truth for this page; storage only seeds it, so a
// browser that refuses storage still gets a badge that works until it leaves.
let current: number | null = null

function clean(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

export function readUnread(): number {
  if (current === null) {
    try {
      current = clean(Number(sessionStorage.getItem(UNREAD_KEY)))
    } catch {
      current = 0
    }
  }
  return current
}

export function publishUnread(count: number): void {
  const n = clean(count)
  if (n === readUnread()) return
  current = n
  try {
    if (n > 0) sessionStorage.setItem(UNREAD_KEY, String(n))
    else sessionStorage.removeItem(UNREAD_KEY)
  } catch { /* storage unavailable - this page still has the count */ }
  window.dispatchEvent(new Event(LIVE_CHAT_UNREAD_EVENT))
}

export function subscribeUnread(onChange: () => void): () => void {
  window.addEventListener(LIVE_CHAT_UNREAD_EVENT, onChange)
  return () => window.removeEventListener(LIVE_CHAT_UNREAD_EVENT, onChange)
}
