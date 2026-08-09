import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { envProvidedKeys, getLiveChatConfig, updateSettings } from '@/modules/live-chat/lib/settings'
import { getAgentToken } from '@/modules/live-chat/lib/db'

export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const config = await getLiveChatConfig()
  const ownToken = await getAgentToken(user.id)
  // Secrets go back as booleans only.
  return NextResponse.json({
    serverUrl: config.serverUrl,
    accountId: config.accountId,
    inboxId: config.inboxId,
    websiteToken: config.websiteToken,
    hasHmacToken: !!config.hmacToken,
    hasApiToken: !!config.apiToken,
    hasWebhookToken: !!config.webhookToken,
    flyApp: config.flyApp,
    hasFlyToken: !!config.flyToken,
    backupEndpoint: config.backupEndpoint,
    hasBackupToken: !!config.backupToken,
    widgetPosition: config.widgetPosition,
    widgetLabel: config.widgetLabel,
    replyTimeText: config.replyTimeText,
    retentionMonths: config.retentionMonths,
    hasOwnAgentToken: !!ownToken,
    envProvided: envProvidedKeys(),
  })
}

const Body = z.object({
  serverUrl: z.string().url().optional(),
  accountId: z.number().int().positive().optional(),
  inboxId: z.number().int().positive().optional(),
  websiteToken: z.string().min(1).optional(),
  hmacToken: z.string().min(1).optional(),
  apiToken: z.string().min(1).optional(),
  webhookToken: z.string().min(8).optional(),
  flyApp: z.string().min(1).optional(),
  flyToken: z.string().min(1).optional(),
  backupEndpoint: z.string().url().optional(),
  backupToken: z.string().min(8).optional(),
  widgetPosition: z.enum(['left', 'right']).optional(),
  widgetLabel: z.string().max(60).optional(),
  replyTimeText: z.string().max(120).optional(),
  retentionMonths: z.number().int().min(1).max(120).optional(),
})

export async function PATCH(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)
  if (!process.env.ENCRYPTION_KEY) {
    return errorResponse('ENCRYPTION_KEY is not set. Add it to your environment before saving secrets.', 503)
  }
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')
  await updateSettings(parsed.data)
  return NextResponse.json({ ok: true })
}
