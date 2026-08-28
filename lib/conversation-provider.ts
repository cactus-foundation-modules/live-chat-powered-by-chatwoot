import type {
  ConversationListOptions,
  ConversationListPage,
  ConversationMessage,
  ConversationProvider,
  ConversationSummary,
  ConversationThread,
} from '@/lib/conversations/types'
import {
  clearUnread,
  getAgentToken,
  getConversation,
  listConversationSummaries,
  listConversationsByEmails,
  listMessages,
  type MirrorConversation,
  type MirrorMessage,
} from './db'
import { markConversationRead, sendMessage } from './chatwoot'

// Live chat conversations, published as conversations.
//
// Core can merge every channel a site runs into one list, and to do that it
// needs data rather than a React panel. This is the same mirror the chat inbox
// reads - Chatwoot stays the source of truth and this module stays the only
// thing that talks to it.
//
// The reply below goes out through Chatwoot's own API with the acting person's
// agent token, so what the customer sees is a genuine agent reply from a
// colleague with a name, and the Chatwoot mobile app agrees with the website.
// Anything else would be a forgery wearing the site's face.
//
// SERVER ONLY. The manifest entry sets serverOnly: this file reaches the
// database and the Chatwoot API, neither of which belongs in a browser bundle.

const PREVIEW_CHARS = 160

function preview(text: string | null): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

function toSummary(row: MirrorConversation): ConversationSummary {
  return {
    id: String(row.id),
    channel: 'chat',
    // A chat has no subject. Naming the person it is with beats an empty
    // heading in a merged list, where every other row has one.
    subject: row.contactName ? `Chat with ${row.contactName}` : 'Live chat',
    preview: preview(row.lastMessagePreview),
    participant: {
      name: row.contactName,
      email: row.contactEmail,
      phone: null,
    },
    lastMessageAt: row.lastMessageAt ?? new Date(0),
    unread: row.unreadForAgents > 0,
    status: row.status === 'resolved' ? 'closed' : 'open',
    // Admin-root relative, no leading slash - the admin path is per site.
    href: 'inbox?tab=live-chat',
  }
}

function toMessage(row: MirrorMessage): ConversationMessage {
  const attachments = (row.attachments ?? [])
    .map((a) => {
      const url = typeof a.data_url === 'string' ? a.data_url : typeof a.file_url === 'string' ? a.file_url : null
      if (!url) return null
      const name = url.split('/').pop() || 'attachment'
      return {
        filename: decodeURIComponent(name.split('?')[0] || 'attachment'),
        url,
        contentType: typeof a.file_type === 'string' ? a.file_type : null,
      }
    })
    .filter((a): a is { filename: string; url: string; contentType: string | null } => a !== null)

  return {
    id: String(row.id),
    // A private note in Chatwoot is a colleague talking to a colleague, and it
    // must never render as something the customer saw.
    direction: row.isPrivate ? 'note' : row.senderType === 'contact' ? 'in' : 'out',
    authorName: row.senderName,
    text: row.content ?? '',
    html: null,
    sentAt: row.createdAt,
    attachments,
  }
}

function idOf(id: string): number | null {
  const n = Number(id)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

async function list(opts: ConversationListOptions): Promise<ConversationListPage> {
  const before = opts.cursor ? new Date(opts.cursor) : undefined
  const rows = await listConversationSummaries({
    since: opts.since,
    before: before && !Number.isNaN(before.getTime()) ? before : undefined,
    limit: opts.limit,
  })
  const last = rows[rows.length - 1]
  return {
    items: rows.map(toSummary),
    nextCursor:
      rows.length >= opts.limit && last?.lastMessageAt
        ? last.lastMessageAt.toISOString()
        : undefined,
  }
}

async function thread(id: string): Promise<ConversationThread | null> {
  const numeric = idOf(id)
  if (numeric === null) return null
  const conversation = await getConversation(numeric)
  if (!conversation) return null
  const messages = await listMessages(numeric)
  return { summary: toSummary(conversation), messages: messages.map(toMessage) }
}

async function send(
  id: string,
  body: { text: string; html?: string; authorUserId: string },
): Promise<void> {
  const numeric = idOf(id)
  if (numeric === null) throw new Error('That chat could not be found.')

  // Each colleague replies as themselves, which is the whole reason the token
  // is stored per person. Somebody who has never connected their own account
  // gets told exactly that and where to fix it - posting as somebody else
  // instead would be worse than not sending at all.
  const token = await getAgentToken(body.authorUserId)
  if (!token) {
    throw new Error(
      'You have not connected your live chat account yet, so this reply would go out as somebody else. ' +
        'Connect it under Settings, Live Chat, and then send it again.',
    )
  }

  await sendMessage(numeric, body.text, { token })
  await clearUnread(numeric)
}

async function markRead(id: string): Promise<void> {
  const numeric = idOf(id)
  if (numeric === null) return
  await clearUnread(numeric)
  // Chatwoot's own idea of "seen" is best-effort: the mirror is what this site
  // reads, and a chat that will not mark itself read at the far end is not a
  // reason to fail whatever asked.
  await markConversationRead(numeric).catch((err) =>
    console.error('[live-chat] could not mark the chat read in Chatwoot:', err),
  )
}

async function byIdentity(identity: { emails: string[] }): Promise<ConversationSummary[]> {
  const rows = await listConversationsByEmails(identity.emails)
  return rows.map(toSummary)
}

export const liveChatConversationProvider: ConversationProvider = {
  label: 'Live chat',
  channel: 'chat',
  capabilities: { reply: true, markRead: true, byIdentity: true },
  list,
  thread,
  send,
  markRead,
  byIdentity,
}
