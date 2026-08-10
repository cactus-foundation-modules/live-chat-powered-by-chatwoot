import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

// Live chat is now a tab of core's shared Inbox rather than a screen of its own
// (see components/InboxPanel). This route stays put so old bookmarks and any
// links left in email notifications still land somewhere sensible.
export default async function LiveChatInboxRedirect() {
  const adminPath = (await headers()).get('x-cactus-admin-path') ?? 'cactus-admin'
  return redirect(`/${adminPath}/inbox?tab=live-chat`)
}
