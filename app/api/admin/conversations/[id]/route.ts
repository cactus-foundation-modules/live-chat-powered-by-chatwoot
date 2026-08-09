import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { clearUnread, getAgentToken, getConversation, listMessages } from '@/modules/live-chat/lib/db'
import { ChatwootError, markConversationRead, toggleConversationStatus } from '@/modules/live-chat/lib/chatwoot'
import { syncChatNotification } from '@/modules/live-chat/lib/notify'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.view')) return errorResponse('Forbidden', 403)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return errorResponse('Bad conversation id')
  const [conversation, messages] = await Promise.all([getConversation(id), listMessages(id)])
  if (!conversation) return errorResponse('Not found', 404)
  return NextResponse.json({ conversation, messages })
}

const ActionBody = z.object({ action: z.enum(['resolve', 'reopen', 'read']) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.reply')) return errorResponse('Forbidden', 403)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return errorResponse('Bad conversation id')
  const parsed = ActionBody.safeParse(await request.json())
  if (!parsed.success) return errorResponse('Invalid action')

  const agentToken = await getAgentToken(user.id)
  try {
    if (parsed.data.action === 'read') {
      await markConversationRead(id, agentToken)
      await clearUnread(id)
      syncChatNotification().catch(() => {})
    } else {
      await toggleConversationStatus(id, parsed.data.action === 'resolve' ? 'resolved' : 'open', agentToken)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = err instanceof ChatwootError ? err.status : 500
    return errorResponse(err instanceof Error ? err.message : 'Chatwoot call failed', status >= 400 && status < 600 ? status : 500)
  }
}
