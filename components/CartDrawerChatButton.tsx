'use client'

import { useSyncExternalStore } from 'react'
import { LIVE_CHAT_OPEN_EVENT } from '@/modules/live-chat/lib/open-event'
import { readUnread, subscribeUnread } from '@/modules/live-chat/lib/unread'
import { BUBBLE_BG, BUBBLE_FG } from '@/modules/live-chat/lib/bubble-style'
import {
  readChatButtonLabel,
  subscribeChatButtonLabel,
  type CartDrawerExtraProps,
} from '@/modules/live-chat/lib/cart-drawer-seam'

// The chat bubble, full width, under "View full basket" in the shop's slide-out
// basket. The floating bubble steps aside while the basket is open (it sat over
// the panel's own buttons), so this is where chat lives until it shuts.
//
// Registered by the widget loader (lib/cart-drawer-seam.ts) and drawn by the
// basket, which knows nothing about it beyond its `close` prop. The geometry is
// the basket's own `scd-extra` class, so it is the same height and corners as
// the buttons above it; the colours are the bubble's.
//
// It starts nothing itself. It shuts the basket - the chat panel and the basket
// cannot both have the screen - and fires the event the widget answers, so the
// first chat of a visit still goes through boot, the cookie question and
// Turnstile in the one place that understands them. Same route as the Mobile
// Bar's chat cell.
export function CartDrawerChatButton({ close }: CartDrawerExtraProps) {
  const label = useSyncExternalStore(subscribeChatButtonLabel, readChatButtonLabel, () => '')
  const unread = useSyncExternalStore(subscribeUnread, readUnread, () => 0)
  const name = label || 'Live chat'
  return (
    <button
      type="button"
      className="scd-extra"
      aria-label={unread > 0 ? `${name} - ${unread} unread` : name}
      style={{ background: BUBBLE_BG, color: BUBBLE_FG }}
      onClick={() => {
        close()
        window.dispatchEvent(new Event(LIVE_CHAT_OPEN_EVENT))
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span>{name}</span>
    </button>
  )
}
