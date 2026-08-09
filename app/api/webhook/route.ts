import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { insertMessage, upsertConversation } from '@/modules/live-chat/lib/db'

// Chatwoot webhook ingest. Chatwoot does not sign webhooks, so the URL carries
// a long random token (?token=...) that must match the configured secret -
// requests without it are rejected before anything is parsed.

type WebhookPayload = {
  event?: string
  id?: number
  status?: string
  messages?: Array<Record<string, unknown>>
  meta?: {
    sender?: { name?: string; email?: string | null }
    assignee?: { name?: string } | null
  }
  additional_attributes?: Record<string, unknown>
  // message_created shape
  conversation?: {
    id?: number
    status?: string
    meta?: { sender?: { name?: string; email?: string | null }; assignee?: { name?: string } | null }
    additional_attributes?: Record<string, unknown>
  }
  message_type?: string
  content?: string | null
  private?: boolean
  sender?: { name?: string; type?: string } | null
  attachments?: Array<Record<string, unknown>>
  created_at?: string | number
}

function toDate(value: string | number | undefined): Date | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return new Date(value * 1000)
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

export async function POST(request: NextRequest) {
  const config = await getLiveChatConfig()
  const token = request.nextUrl.searchParams.get('token') ?? ''
  if (!config.webhookToken || token !== config.webhookToken) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 })
  }

  const event = payload.event ?? ''

  try {
    if (event === 'conversation_created' || event === 'conversation_updated' || event === 'conversation_status_changed') {
      if (typeof payload.id === 'number') {
        await upsertConversation({
          id: payload.id,
          contactEmail: payload.meta?.sender?.email ?? null,
          contactName: payload.meta?.sender?.name ?? null,
          status: payload.status ?? 'open',
          assigneeName: payload.meta?.assignee?.name ?? null,
          meta: payload.additional_attributes ?? null,
        })
      }
    } else if (event === 'message_created' || event === 'message_updated') {
      const conv = payload.conversation
      const conversationId = conv?.id
      if (typeof conversationId === 'number' && typeof payload.id === 'number') {
        await upsertConversation({
          id: conversationId,
          contactEmail: conv?.meta?.sender?.email ?? null,
          contactName: conv?.meta?.sender?.name ?? null,
          status: conv?.status ?? 'open',
          assigneeName: conv?.meta?.assignee?.name ?? null,
          meta: conv?.additional_attributes ?? null,
        })
        const senderType = payload.message_type === 'incoming' ? 'contact'
          : payload.message_type === 'outgoing' ? 'agent'
          : 'system'
        await insertMessage({
          id: payload.id,
          conversationId,
          senderType,
          senderName: payload.sender?.name ?? null,
          content: payload.content ?? null,
          attachments: payload.attachments && payload.attachments.length > 0 ? payload.attachments : null,
          isPrivate: !!payload.private,
          createdAt: toDate(payload.created_at),
        })
      }
    }
    // Unhandled events are fine - 200 keeps Chatwoot from retrying.
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[live-chat] webhook ingest failed:', err)
    return NextResponse.json({ error: 'ingest failed' }, { status: 500 })
  }
}
