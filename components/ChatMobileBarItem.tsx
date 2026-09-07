'use client'

import { LIVE_CHAT_OPEN_EVENT } from '@/modules/live-chat/lib/open-event'
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
export function ChatMobileBarItem({ label, showLabels }: ModuleMobileBarItemProps) {
  const caption = (label || '').trim()
  return (
    <button
      type="button"
      className="cmb-item"
      aria-label={caption || 'Live chat'}
      onClick={() => window.dispatchEvent(new Event(LIVE_CHAT_OPEN_EVENT))}
    >
      <span className="cmb-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </span>
      {showLabels === 'yes' && caption ? <span className="cmb-label">{caption}</span> : null}
    </button>
  )
}
