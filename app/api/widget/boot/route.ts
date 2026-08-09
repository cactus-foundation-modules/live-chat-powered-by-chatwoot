import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { identifierHash } from '@/modules/live-chat/lib/identity'
import { getAvailability } from '@/modules/live-chat/lib/chatwoot'

// Public boot endpoint the widget loader calls when a visitor clicks the chat
// bubble. Nothing chat-related loads before that click. When core Turnstile is
// configured, the loader runs a managed (invisible-for-most) challenge and the
// token is verified here before the widget config is handed out. Logged-in
// members get a server-computed identifier hash so nobody can impersonate them.
export async function POST(request: NextRequest) {
  const config = await getLiveChatConfig()
  if (!config.serverUrl || !config.websiteToken) {
    return errorResponse('Live chat is not configured', 503)
  }

  // No API rate limit here: chat messages flow browser -> Chatwoot directly,
  // never through this route, so the meaningful spam gates are the Turnstile
  // check below and Chatwoot's own controls. This route only hands out the
  // (by-design public) widget config.
  const body = await request.json().catch(() => ({})) as { turnstileToken?: string }
  if (process.env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(body.turnstileToken)
    if (!ok) return errorResponse('Verification failed', 403)
  }

  const payload: Record<string, unknown> = {
    serverUrl: config.serverUrl,
    websiteToken: config.websiteToken,
    position: config.widgetPosition,
  }

  const user = await getSessionFromCookie().catch(() => null)
  if (user && config.hmacToken) {
    const identifier = user.id
    payload.identity = {
      identifier,
      identifierHash: identifierHash(identifier, config.hmacToken),
      name: user.displayName ?? user.username ?? undefined,
      email: user.email ?? undefined,
    }
  }

  return NextResponse.json(payload)
}

export async function GET() {
  // Pre-click config for the loader: bubble copy, whether Turnstile runs, and
  // whether the page-journey buffer is consent-gated. The client cannot tell
  // "banner switched off" from "nothing granted" (core defines
  // window.__cactusConsent either way), so the server decides: the journey is
  // gated only when the consent banner is enabled AND it actually carries a
  // live-chat category for the visitor to grant.
  const config = await getLiveChatConfig()
  let journeyGate: 'allowed' | 'category' = 'allowed'
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const site = await prisma.siteConfig.findUnique({
      where: { id: 'singleton' },
      select: { consentBannerConfig: true },
    })
    const banner = site?.consentBannerConfig as { enabled?: boolean; categories?: Array<{ key: string }> } | null
    if (banner?.enabled && (banner.categories ?? []).some((c) => c.key === 'live-chat')) {
      journeyGate = 'category'
    }
  } catch { /* config unreadable - default to allowed, matching no-banner sites */ }
  // Bubble copy follows the manual Online/Offline switch: away = honest
  // "Leave us a message". Best-effort with a short timeout - an unreachable
  // chat server must not delay the page, so the bubble just defaults to the
  // online copy.
  let online = true
  if (config.serverUrl && config.accountId && config.apiToken) {
    try {
      const availability = await Promise.race([
        getAvailability(config.apiToken, config.serverUrl, config.accountId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ])
      if (availability === 'offline' || availability === 'busy') online = false
    } catch { /* default to online copy */ }
  }

  // Nobody online AND no SMTP on the site means an offline message has no way
  // to reach a human (no missed-message emails to forward it) - so the widget
  // hides entirely rather than collecting messages into a void. The moment
  // either changes (back online, or SMTP filled in), it reappears on the next
  // page load.
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  const enabled = !!(config.serverUrl && config.websiteToken) && (online || smtpConfigured)

  return NextResponse.json({
    enabled,
    label: config.widgetLabel,
    replyTime: config.replyTimeText,
    position: config.widgetPosition,
    turnstileSiteKey: process.env.TURNSTILE_SECRET_KEY ? (process.env.TURNSTILE_SITE_KEY ?? null) : null,
    journeyGate,
    online,
  })
}
