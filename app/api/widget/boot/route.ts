import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { identifierHash } from '@/modules/live-chat/lib/identity'

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
  // Pre-click config for the loader: bubble copy and whether Turnstile runs.
  const config = await getLiveChatConfig()
  return NextResponse.json({
    enabled: !!(config.serverUrl && config.websiteToken),
    label: config.widgetLabel,
    replyTime: config.replyTimeText,
    position: config.widgetPosition,
    turnstileSiteKey: process.env.TURNSTILE_SECRET_KEY ? (process.env.TURNSTILE_SITE_KEY ?? null) : null,
  })
}
