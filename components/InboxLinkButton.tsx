'use client'

import Link from 'next/link'

// Button on the contact-form inbox toolbar (contact-form.inbox-actions point)
// linking through to the Live Chat conversations page.
export function InboxLinkButton({ adminPath }: { adminPath?: string }) {
  return (
    <Link href={`/${adminPath ?? ''}/m/live-chat/live-chat`} className="btn btn-sm">
      Live Chats
    </Link>
  )
}
