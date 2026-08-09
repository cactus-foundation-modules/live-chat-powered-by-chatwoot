import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { listMachines, restartMachine, setAppSecrets } from '@/modules/live-chat/lib/fly'

// The chat server is a separate machine, so it can't read this install's email
// settings on its own. This route bridges them: it takes the SMTP values the
// owner keeps under admin > Settings > Email (the ordinary SMTP_* environment
// values) plus the site's sender name/address, pushes them to the Fly app as
// secrets under the names Chatwoot expects, and restarts the machine. One
// button in the Live Chat settings tab, no credentials typed twice.
export async function POST() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const config = await getLiveChatConfig()
  if (!config.flyToken || !config.flyApp) return errorResponse('Fly access is not configured', 503)

  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT ?? '587'
  const smtpUser = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !smtpUser || !pass) {
    return errorResponse('Fill in the SMTP section under Settings > Email first (SMTP host, username and password), then deploy so they reach this site, then press this again.')
  }

  const site = await prisma.$queryRaw<Array<{ emailFromName: string | null; emailFromAddress: string | null; siteName: string | null }>>`
    SELECT "emailFromName", "emailFromAddress", "siteName" FROM "SiteConfig" WHERE "id" = 'singleton' LIMIT 1
  `.catch(() => [])
  const fromAddress = site[0]?.emailFromAddress || smtpUser
  const fromName = site[0]?.emailFromName || site[0]?.siteName || 'Live Chat'

  try {
    await setAppSecrets(config.flyToken, config.flyApp, {
      SMTP_ADDRESS: host,
      SMTP_PORT: port,
      SMTP_USERNAME: smtpUser,
      SMTP_PASSWORD: pass,
      SMTP_AUTHENTICATION: 'login',
      SMTP_ENABLE_STARTTLS_AUTO: 'true',
      MAILER_SENDER_EMAIL: `${fromName} <${fromAddress}>`,
    })
    const machines = await listMachines(config.flyToken, config.flyApp)
    const machine = machines[0]
    if (machine) await restartMachine(config.flyToken, config.flyApp, machine.id)
    return NextResponse.json({ ok: true, restarted: !!machine })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Sync failed', 502)
  }
}
