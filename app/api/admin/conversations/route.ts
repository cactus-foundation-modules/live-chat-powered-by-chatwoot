import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { listConversations, totalUnread } from '@/modules/live-chat/lib/db'

export async function GET(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.view')) return errorResponse('Forbidden', 403)

  const status = request.nextUrl.searchParams.get('status') === 'resolved' ? 'resolved' : 'open'
  const [conversations, unread] = await Promise.all([listConversations(status), totalUnread()])
  // Live data - never let a browser or proxy serve it stale.
  return NextResponse.json({ conversations, unread }, { headers: { 'Cache-Control': 'no-store' } })
}
