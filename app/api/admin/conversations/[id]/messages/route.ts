import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getAgentToken } from '@/modules/live-chat/lib/db'
import { ChatwootError, sendMessage } from '@/modules/live-chat/lib/chatwoot'

// Reply into a conversation. multipart/form-data: content + files[] (attachments,
// relayed straight to Chatwoot which stores them on the chat machine's volume).
const MAX_FILE_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = /^(image\/|video\/|audio\/|application\/pdf|text\/plain|application\/vnd\.openxmlformats|application\/msword|application\/vnd\.ms-excel)/

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.reply')) return errorResponse('Forbidden', 403)

  const id = Number((await params).id)
  if (!Number.isInteger(id)) return errorResponse('Bad conversation id')

  let content = ''
  let files: File[] = []
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    content = String(form.get('content') ?? '')
    files = form.getAll('files').filter((f): f is File => f instanceof File)
  } else {
    const body = await request.json().catch(() => null) as { content?: string } | null
    content = body?.content ?? ''
  }

  if (!content.trim() && files.length === 0) return errorResponse('Nothing to send')
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return errorResponse(`"${f.name}" is over the 15 MB attachment limit`)
    if (!ALLOWED_TYPES.test(f.type)) return errorResponse(`"${f.name}" is not an allowed file type`)
  }

  const agentToken = await getAgentToken(user.id)
  try {
    const message = await sendMessage(id, content.trim(), { token: agentToken, files })
    return NextResponse.json({ ok: true, message })
  } catch (err) {
    const status = err instanceof ChatwootError ? err.status : 500
    return errorResponse(err instanceof Error ? err.message : 'Send failed', status >= 400 && status < 600 ? status : 500)
  }
}
