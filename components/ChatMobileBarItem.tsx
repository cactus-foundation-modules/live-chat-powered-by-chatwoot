'use client'

import { useSyncExternalStore } from 'react'
import { LIVE_CHAT_OPEN_EVENT } from '@/modules/live-chat/lib/open-event'
import { readUnread, subscribeUnread } from '@/modules/live-chat/lib/unread'
import type { ModuleMobileBarItemProps } from '@/lib/puck/mobileBar'

// This module's cell in core's Mobile Bar (`core.mobile-bar-items`): a message
// icon that opens the live chat.
//
// It draws none of its own chrome - the .cmb-* classes are core's, published by
// the bar, so this button matches the cells beside it without either side
// coordinating. And it starts nothing itself: pressing it fires the event the
// widget answers, so the first chat of a visit still goes through boot, the
// cookie question and Turnstile in the one place that understands them.
//
// The chat widget still has to be on the page - the Live Chat block placed in
// the header or footer, as it always had to be. With no widget there, nothing
// answers the event and the button does nothing, which is the same as the
// bubble not being there either.
//
// The number on the icon is replies the visitor has not read yet (or, for
// staff, chats waiting on an answer), published by whichever of the widget or
// the staff console is on the page. Core's .cmb-badge draws it, in the colours
// the owner set for the bar, same as the basket count beside it.
export function ChatMobileBarItem({ label, showLabels }: ModuleMobileBarItemProps) {
  const caption = (label || '').trim()
  const unread = useSyncExternalStore(subscribeUnread, readUnread, () => 0)
  const name = caption || 'Live chat'
  return (
    <button
      type="button"
      className="cmb-item"
      aria-label={unread > 0 ? `${name} - ${unread} unread` : name}
      onClick={() => window.dispatchEvent(new Event(LIVE_CHAT_OPEN_EVENT))}
    >
      <span className="cmb-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread > 0 && <span className="cmb-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </span>
      {showLabels === 'yes' && caption ? <span className="cmb-label">{caption}</span> : null}
    </button>
  )
}
