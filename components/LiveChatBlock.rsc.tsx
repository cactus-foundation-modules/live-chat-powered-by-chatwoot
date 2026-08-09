import { connection } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { WidgetLoader } from './WidgetLoader'
import { AgentConsole } from './AgentConsole'
import { liveChatBlockComponent } from './LiveChatBlock'

const API_BASE = '/api/m/live-chat'

async function LiveChatRsc() {
  await connection()
  const config = await getLiveChatConfig()
  if (!config.serverUrl || !config.websiteToken) return null

  const user = await getSessionFromCookie().catch(() => null)
  if (user && await hasPermission(user, 'livechat.view').catch(() => false)) {
    // Staff browsing the shop answer chats from here instead of chatting with
    // themselves through the customer widget.
    return <AgentConsole apiBase={API_BASE} position={config.widgetPosition} />
  }
  return <WidgetLoader apiBase={API_BASE} />
}

export const liveChatBlockRscComponent = { ...liveChatBlockComponent, render: LiveChatRsc }
