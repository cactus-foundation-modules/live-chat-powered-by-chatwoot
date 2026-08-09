import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { encryptSecret } from '@/lib/crypto/secrets'
import { setAgentToken } from '@/modules/live-chat/lib/db'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { getProfilePubsubToken } from '@/modules/live-chat/lib/chatwoot'

// Each admin saves their own Chatwoot agent token so replies attribute to the
// right person. Validated against the Chatwoot profile endpoint before saving.
const Body = z.object({ token: z.string().min(10) })

export async function POST(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.reply')) return errorResponse('Forbidden', 403)
  if (!process.env.ENCRYPTION_KEY) return errorResponse('ENCRYPTION_KEY is not set', 503)

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse('Invalid token')

  const config = await getLiveChatConfig()
  if (!config.serverUrl) return errorResponse('Live chat is not configured yet', 503)

  try {
    const profile = await getProfilePubsubToken(parsed.data.token, config.serverUrl)
    await setAgentToken(user.id, encryptSecret(parsed.data.token), profile.agentId)
    return NextResponse.json({ ok: true, agentId: profile.agentId })
  } catch {
    return errorResponse('Chatwoot rejected that token - copy it from Profile Settings > Access Token on the chat server')
  }
}

export async function DELETE() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.reply')) return errorResponse('Forbidden', 403)
  await setAgentToken(user.id, null, null)
  return NextResponse.json({ ok: true })
}
