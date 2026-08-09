import { NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getAgentToken } from '@/modules/live-chat/lib/db'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { getProfilePubsubToken, setAvailability } from '@/modules/live-chat/lib/chatwoot'

// Hands the admin's browser what it needs for the direct ActionCable
// connection to the chat server: the LIMITED pubsub token, never the full
// agent token. Also flips the agent online so the widget shows it truthfully.
export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.view')) return errorResponse('Forbidden', 403)

  const config = await getLiveChatConfig()
  if (!config.serverUrl) return errorResponse('Live chat is not configured yet', 503)

  const agentToken = await getAgentToken(user.id) ?? config.apiToken
  if (!agentToken) return errorResponse('No agent token available - add yours in Settings > Live Chat', 503)

  try {
    const profile = await getProfilePubsubToken(agentToken, config.serverUrl)
    // Availability is deliberately NOT touched here: it's the manual
    // Online/Offline switch on the inbox (see the availability route), and
    // auto-flagging on page-open would fight a chosen Offline.
    return NextResponse.json({
      serverUrl: config.serverUrl,
      pubsubToken: profile.pubsubToken,
      accountId: profile.accountId,
    })
  } catch {
    return errorResponse('Could not reach the chat server', 502)
  }
}
