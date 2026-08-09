import { NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'

// Reveals the chat server's login (the one the mobile app uses). Password only
// ever travels on this explicit, manage-gated request - the settings GET
// carries booleans.
export async function POST() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const config = await getLiveChatConfig()
  if (!config.chatLoginEmail) return errorResponse('No chat login is recorded for this install', 404)
  return NextResponse.json({
    email: config.chatLoginEmail,
    password: config.chatLoginPassword, // null on centrally managed installs
    serverUrl: config.serverUrl,
  })
}
