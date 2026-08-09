import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { LiveChatClient } from '@/modules/live-chat/components/LiveChatClient'

export const metadata = { title: 'Live Chat' }

export default async function LiveChatPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'livechat.view')) {
    return <div className="alert alert-danger">You do not have permission to view this page.</div>
  }
  const canManage = await hasPermission(user, 'livechat.manage')
  return <LiveChatClient canManage={canManage} />
}
