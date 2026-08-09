import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { ChatwootError, createCannedResponse, deleteCannedResponse, listCannedResponses, updateCannedResponse } from '@/modules/live-chat/lib/chatwoot'

function chatwootFail(err: unknown) {
  const status = err instanceof ChatwootError ? err.status : 500
  return errorResponse(err instanceof Error ? err.message : 'Chatwoot call failed', status >= 400 && status < 600 ? status : 500)
}

export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.view')) return errorResponse('Forbidden', 403)
  try {
    return NextResponse.json({ canned: await listCannedResponses() })
  } catch (err) {
    return chatwootFail(err)
  }
}

const UpsertBody = z.object({
  id: z.number().int().optional(),
  shortCode: z.string().min(1).max(60).regex(/^[a-z0-9_-]+$/i, 'Shortcode: letters, numbers, dashes only'),
  content: z.string().min(1).max(5000),
})

export async function POST(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)
  const parsed = UpsertBody.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')
  const { id, shortCode, content } = parsed.data
  try {
    if (id) await updateCannedResponse(id, shortCode, content)
    else await createCannedResponse(shortCode, content)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return chatwootFail(err)
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id)) return errorResponse('Bad id')
  try {
    await deleteCannedResponse(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return chatwootFail(err)
  }
}
