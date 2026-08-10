import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { LiveChatClient } from '@/modules/live-chat/components/LiveChatClient'

// Live chat as a panel on core's shared Inbox (`core.inbox-tabs`), so chats and
// the site's other messages sit behind one sidebar link rather than one each.
// The permission check stays here rather than relying on the host's: the panel is
// a component, and a component that renders whatever it is handed is one refactor
// away from rendering conversations to someone who may not read them.
export async function LiveChatInboxPanel() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'livechat.view')) {
    return <div className="alert alert-danger">You do not have permission to view this page.</div>
  }
  const canManage = await hasPermission(user, 'livechat.manage')
  return <LiveChatClient canManage={canManage} />
}
