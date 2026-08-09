import { prisma } from '@/lib/db/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'

// ---------------------------------------------------------------------------
// Module settings, resolved env-first.
//
// A pre-provisioned install (Deskwell) carries everything as LIVECHAT_* env
// vars seeded on the Vercel project, so the module works the moment the site
// updates - before anyone opens the setup UI. Values saved through the
// settings UI land in the lc_settings singleton (secrets encrypted) and are
// used when the env var is absent. Env wins so a rotated env secret can never
// be shadowed by a stale row.
// ---------------------------------------------------------------------------

export type LiveChatConfig = {
  serverUrl: string | null
  accountId: number | null
  inboxId: number | null
  websiteToken: string | null
  hmacToken: string | null
  apiToken: string | null
  webhookToken: string | null
  flyApp: string | null
  flyToken: string | null
  backupEndpoint: string | null
  backupToken: string | null
  widgetPosition: 'left' | 'right'
  widgetLabel: string
  replyTimeText: string
  retentionMonths: number
}

type SettingsRow = Record<string, unknown>

async function getRow(): Promise<SettingsRow | null> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT * FROM "lc_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return rows[0] ?? null
}

function dec(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    return decryptSecret(value)
  } catch {
    return null
  }
}

export async function getLiveChatConfig(): Promise<LiveChatConfig> {
  const row = await getRow()
  const env = process.env
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const num = (v: unknown) => (typeof v === 'number' ? v : null)

  return {
    serverUrl: env.LIVECHAT_SERVER_URL ?? str(row?.server_url),
    accountId: env.LIVECHAT_ACCOUNT_ID ? Number(env.LIVECHAT_ACCOUNT_ID) : num(row?.account_id),
    inboxId: env.LIVECHAT_INBOX_ID ? Number(env.LIVECHAT_INBOX_ID) : num(row?.inbox_id),
    websiteToken: env.LIVECHAT_WEBSITE_TOKEN ?? str(row?.website_token),
    hmacToken: env.LIVECHAT_HMAC_TOKEN ?? dec(row?.hmac_token_encrypted),
    apiToken: env.LIVECHAT_API_TOKEN ?? dec(row?.api_token_encrypted),
    webhookToken: env.LIVECHAT_WEBHOOK_TOKEN ?? str(row?.webhook_token),
    flyApp: env.LIVECHAT_FLY_APP ?? str(row?.fly_app),
    flyToken: env.LIVECHAT_FLY_TOKEN ?? dec(row?.fly_token_encrypted),
    backupEndpoint: env.LIVECHAT_BACKUP_ENDPOINT ?? str(row?.backup_endpoint),
    backupToken: env.LIVECHAT_BACKUP_TOKEN ?? dec(row?.backup_token_encrypted),
    widgetPosition: str(row?.widget_position) === 'left' ? 'left' : 'right',
    widgetLabel: str(row?.widget_label) ?? 'Chat with us',
    replyTimeText: str(row?.reply_time_text) ?? 'We usually reply within a few hours',
    retentionMonths: num(row?.retention_months) ?? 12,
  }
}

// Which of the connection values came from env - the settings UI greys those out.
export function envProvidedKeys(): string[] {
  const keys = [
    'LIVECHAT_SERVER_URL', 'LIVECHAT_ACCOUNT_ID', 'LIVECHAT_INBOX_ID',
    'LIVECHAT_WEBSITE_TOKEN', 'LIVECHAT_HMAC_TOKEN', 'LIVECHAT_API_TOKEN',
    'LIVECHAT_WEBHOOK_TOKEN', 'LIVECHAT_FLY_APP', 'LIVECHAT_FLY_TOKEN',
    'LIVECHAT_BACKUP_ENDPOINT', 'LIVECHAT_BACKUP_TOKEN',
  ]
  return keys.filter((k) => !!process.env[k])
}

export type UpdatableSettings = Partial<{
  serverUrl: string
  accountId: number
  inboxId: number
  websiteToken: string
  hmacToken: string
  apiToken: string
  webhookToken: string
  flyApp: string
  flyToken: string
  backupEndpoint: string
  backupToken: string
  widgetPosition: 'left' | 'right'
  widgetLabel: string
  replyTimeText: string
  retentionMonths: number
  provisionState: unknown
}>

export async function updateSettings(data: UpdatableSettings): Promise<void> {
  const row = await getRow()
  const enc = (v: string | undefined, existing: unknown) =>
    v !== undefined ? encryptSecret(v) : ((existing as string | null) ?? null)
  const keep = <T,>(v: T | undefined, existing: unknown, fallback: T): T =>
    v !== undefined ? v : ((existing as T | null) ?? fallback)

  const values = {
    server_url: keep<string | null>(data.serverUrl, row?.server_url, null),
    account_id: keep<number | null>(data.accountId, row?.account_id, null),
    inbox_id: keep<number | null>(data.inboxId, row?.inbox_id, null),
    website_token: keep<string | null>(data.websiteToken, row?.website_token, null),
    hmac_token_encrypted: enc(data.hmacToken, row?.hmac_token_encrypted),
    api_token_encrypted: enc(data.apiToken, row?.api_token_encrypted),
    webhook_token: keep<string | null>(data.webhookToken, row?.webhook_token, null),
    fly_app: keep<string | null>(data.flyApp, row?.fly_app, null),
    fly_token_encrypted: enc(data.flyToken, row?.fly_token_encrypted),
    backup_endpoint: keep<string | null>(data.backupEndpoint, row?.backup_endpoint, null),
    backup_token_encrypted: enc(data.backupToken, row?.backup_token_encrypted),
    widget_position: keep<string>(data.widgetPosition, row?.widget_position, 'right'),
    widget_label: keep<string>(data.widgetLabel, row?.widget_label, 'Chat with us'),
    reply_time_text: keep<string>(data.replyTimeText, row?.reply_time_text, 'We usually reply within a few hours'),
    retention_months: keep<number>(data.retentionMonths, row?.retention_months, 12),
    provision_state: data.provisionState !== undefined
      ? JSON.stringify(data.provisionState)
      : (row?.provision_state != null ? JSON.stringify(row.provision_state) : null),
  }

  await prisma.$executeRaw`
    INSERT INTO "lc_settings" (
      "id", "server_url", "account_id", "inbox_id", "website_token",
      "hmac_token_encrypted", "api_token_encrypted", "webhook_token",
      "fly_app", "fly_token_encrypted", "backup_endpoint", "backup_token_encrypted",
      "widget_position", "widget_label", "reply_time_text", "retention_months",
      "provision_state", "updated_at"
    ) VALUES (
      'singleton', ${values.server_url}, ${values.account_id}, ${values.inbox_id}, ${values.website_token},
      ${values.hmac_token_encrypted}, ${values.api_token_encrypted}, ${values.webhook_token},
      ${values.fly_app}, ${values.fly_token_encrypted}, ${values.backup_endpoint}, ${values.backup_token_encrypted},
      ${values.widget_position}, ${values.widget_label}, ${values.reply_time_text}, ${values.retention_months},
      ${values.provision_state}::jsonb, now()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "server_url" = EXCLUDED."server_url",
      "account_id" = EXCLUDED."account_id",
      "inbox_id" = EXCLUDED."inbox_id",
      "website_token" = EXCLUDED."website_token",
      "hmac_token_encrypted" = EXCLUDED."hmac_token_encrypted",
      "api_token_encrypted" = EXCLUDED."api_token_encrypted",
      "webhook_token" = EXCLUDED."webhook_token",
      "fly_app" = EXCLUDED."fly_app",
      "fly_token_encrypted" = EXCLUDED."fly_token_encrypted",
      "backup_endpoint" = EXCLUDED."backup_endpoint",
      "backup_token_encrypted" = EXCLUDED."backup_token_encrypted",
      "widget_position" = EXCLUDED."widget_position",
      "widget_label" = EXCLUDED."widget_label",
      "reply_time_text" = EXCLUDED."reply_time_text",
      "retention_months" = EXCLUDED."retention_months",
      "provision_state" = EXCLUDED."provision_state",
      "updated_at" = now()
  `
}
