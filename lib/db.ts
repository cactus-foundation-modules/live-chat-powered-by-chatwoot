import { prisma } from '@/lib/db/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'

// ---------------------------------------------------------------------------
// The lc_ mirror: written by the Chatwoot webhook, read by the admin inbox.
// ---------------------------------------------------------------------------

export type MirrorConversation = {
  id: number
  contactEmail: string | null
  contactName: string | null
  status: string
  assigneeName: string | null
  unreadForAgents: number
  lastMessageAt: Date | null
  lastMessagePreview: string | null
  meta: Record<string, unknown> | null
}

export type MirrorMessage = {
  id: number
  conversationId: number
  senderType: string
  senderName: string | null
  content: string | null
  attachments: Array<Record<string, unknown>> | null
  isPrivate: boolean
  createdAt: Date
}

function mapConversation(r: Record<string, unknown>): MirrorConversation {
  return {
    id: Number(r.id),
    contactEmail: (r.contact_email as string | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null,
    status: (r.status as string) ?? 'open',
    assigneeName: (r.assignee_name as string | null) ?? null,
    unreadForAgents: Number(r.unread_for_agents ?? 0),
    lastMessageAt: (r.last_message_at as Date | null) ?? null,
    lastMessagePreview: (r.last_message_preview as string | null) ?? null,
    meta: (r.meta as Record<string, unknown> | null) ?? null,
  }
}

function mapMessage(r: Record<string, unknown>): MirrorMessage {
  return {
    id: Number(r.id),
    conversationId: Number(r.conversation_id),
    senderType: (r.sender_type as string) ?? 'contact',
    senderName: (r.sender_name as string | null) ?? null,
    content: (r.content as string | null) ?? null,
    attachments: (r.attachments as Array<Record<string, unknown>> | null) ?? null,
    isPrivate: !!r.is_private,
    createdAt: r.created_at as Date,
  }
}

export async function upsertConversation(data: {
  id: number
  contactEmail?: string | null
  contactName?: string | null
  status?: string
  assigneeName?: string | null
  meta?: Record<string, unknown> | null
}): Promise<void> {
  const meta = data.meta !== undefined && data.meta !== null ? JSON.stringify(data.meta) : null
  await prisma.$executeRaw`
    INSERT INTO "lc_conversations" ("id", "contact_email", "contact_name", "status", "assignee_name", "meta", "updated_at")
    VALUES (${data.id}, ${data.contactEmail ?? null}, ${data.contactName ?? null},
            ${data.status ?? 'open'}, ${data.assigneeName ?? null}, ${meta}::jsonb, now())
    ON CONFLICT ("id") DO UPDATE SET
      "contact_email" = COALESCE(EXCLUDED."contact_email", "lc_conversations"."contact_email"),
      "contact_name" = COALESCE(EXCLUDED."contact_name", "lc_conversations"."contact_name"),
      "status" = EXCLUDED."status",
      "assignee_name" = COALESCE(EXCLUDED."assignee_name", "lc_conversations"."assignee_name"),
      "meta" = COALESCE(EXCLUDED."meta", "lc_conversations"."meta"),
      "updated_at" = now()
  `
}

export async function insertMessage(data: {
  id: number
  conversationId: number
  senderType: string
  senderName?: string | null
  content?: string | null
  attachments?: unknown
  isPrivate?: boolean
  createdAt?: Date
}): Promise<void> {
  const attachments = data.attachments != null ? JSON.stringify(data.attachments) : null
  await prisma.$executeRaw`
    INSERT INTO "lc_messages" ("id", "conversation_id", "sender_type", "sender_name", "content", "attachments", "is_private", "created_at")
    VALUES (${data.id}, ${data.conversationId}, ${data.senderType}, ${data.senderName ?? null},
            ${data.content ?? null}, ${attachments}::jsonb, ${data.isPrivate ?? false},
            ${data.createdAt ?? new Date()})
    ON CONFLICT ("id") DO UPDATE SET
      "content" = EXCLUDED."content",
      "attachments" = EXCLUDED."attachments"
  `
  const preview = (data.content ?? '').slice(0, 140) || (attachments ? '[attachment]' : '')
  const unreadDelta = data.senderType === 'contact' && !data.isPrivate ? 1 : 0
  await prisma.$executeRaw`
    UPDATE "lc_conversations" SET
      "last_message_at" = GREATEST(COALESCE("last_message_at", 'epoch'::timestamptz), ${data.createdAt ?? new Date()}),
      "last_message_preview" = ${preview},
      "unread_for_agents" = CASE WHEN ${unreadDelta} = 1 THEN "unread_for_agents" + 1 ELSE "unread_for_agents" END,
      "updated_at" = now()
    WHERE "id" = ${data.conversationId}
  `
}

export async function clearUnread(conversationId: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "lc_conversations" SET "unread_for_agents" = 0, "updated_at" = now()
    WHERE "id" = ${conversationId}
  `
}

export async function listConversations(status: 'open' | 'resolved', limit = 50): Promise<MirrorConversation[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "lc_conversations"
    WHERE "status" = ${status}
    ORDER BY "last_message_at" DESC NULLS LAST
    LIMIT ${limit}
  `
  return rows.map(mapConversation)
}

export async function getConversation(id: number): Promise<MirrorConversation | null> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "lc_conversations" WHERE "id" = ${id} LIMIT 1
  `
  return rows[0] ? mapConversation(rows[0]) : null
}

export async function listMessages(conversationId: number, limit = 200): Promise<MirrorMessage[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "lc_messages"
    WHERE "conversation_id" = ${conversationId}
    ORDER BY "created_at" ASC
    LIMIT ${limit}
  `
  return rows.map(mapMessage)
}

export async function listConversationsByEmail(email: string, limit = 20): Promise<MirrorConversation[]> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "lc_conversations"
    WHERE lower("contact_email") = lower(${email})
    ORDER BY "last_message_at" DESC NULLS LAST
    LIMIT ${limit}
  `
  return rows.map(mapConversation)
}

export async function totalUnread(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
    SELECT COALESCE(SUM("unread_for_agents"), 0) AS total FROM "lc_conversations" WHERE "status" = 'open'
  `
  return Number(rows[0]?.total ?? 0)
}

export async function deleteConversationsOlderThan(months: number): Promise<number> {
  const result = await prisma.$executeRaw`
    DELETE FROM "lc_conversations"
    WHERE "status" = 'resolved'
      AND COALESCE("last_message_at", "updated_at") < now() - make_interval(months => ${months})
  `
  return result
}

export async function deleteConversationsByEmail(email: string): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "lc_conversations" WHERE lower("contact_email") = lower(${email})
  `
}

// --- Per-admin agent tokens -------------------------------------------------

export async function getAgentToken(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ agent_token_encrypted: string | null }>>`
    SELECT "agent_token_encrypted" FROM "lc_admin_tokens" WHERE "user_id" = ${userId} LIMIT 1
  `
  const encrypted = rows[0]?.agent_token_encrypted
  if (!encrypted) return null
  try {
    return decryptSecret(encrypted)
  } catch {
    return null
  }
}

export async function setAgentToken(userId: string, encrypted: string | null, agentId: number | null): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "lc_admin_tokens" ("user_id", "agent_token_encrypted", "chatwoot_agent_id", "updated_at")
    VALUES (${userId}, ${encrypted}, ${agentId}, now())
    ON CONFLICT ("user_id") DO UPDATE SET
      "agent_token_encrypted" = EXCLUDED."agent_token_encrypted",
      "chatwoot_agent_id" = EXCLUDED."chatwoot_agent_id",
      "updated_at" = now()
  `
}
