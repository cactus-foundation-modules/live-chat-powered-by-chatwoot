import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getAgentToken } from '@/modules/live-chat/lib/db'
import { getLiveChatConfig, type LiveChatConfig } from '@/modules/live-chat/lib/settings'
import { getAvailability, setAvailability } from '@/modules/live-chat/lib/chatwoot'

// The Online/Offline switch shown on the admin inbox and the frontend agent
// console. Availability drives what customers see on the widget (online vs
// away) and whether the chat server emails about missed messages. Wholly
// manual: nothing in the module flips it behind your back (the account is
// provisioned with auto-offline disabled for the same reason).
// Returns EITHER a refusal to send back or the token and config to work with.
// The type is written out rather than inferred, and the callers test `r.error`
// rather than `'error' in r`, for a reason worth keeping: TypeScript normalises
// a union of object literals returned from one function by adding the missing
// keys back as optional-undefined, so the success branch ends up carrying
// `error?: undefined` too. `in` cannot then narrow it away, and `r.error` reads
// as `Response | undefined` - which made both handlers infer
// `Promise<Response | undefined>` and fail the module router's handler type.
type ResolvedToken =
  | { error: Response; token?: undefined; config?: undefined }
  | { error?: undefined; token: string; config: LiveChatConfig }

async function resolveToken(): Promise<ResolvedToken> {
  const user = await getSessionFromCookie()
  if (!user) return { error: errorResponse('Not authenticated', 401) }
  if (!await hasPermission(user, 'livechat.reply')) return { error: errorResponse('Forbidden', 403) }
  const config = await getLiveChatConfig()
  if (!config.serverUrl || !config.accountId) return { error: errorResponse('Live chat is not configured yet', 503) }
  const token = await getAgentToken(user.id) ?? config.apiToken
  if (!token) return { error: errorResponse('No agent token available', 503) }
  return { token, config }
}

export async function GET() {
  const r = await resolveToken()
  if (r.error) return r.error
  const availability = await getAvailability(r.token, r.config.serverUrl!, r.config.accountId!)
  return NextResponse.json({ availability })
}

const Body = z.object({ availability: z.enum(['online', 'offline']) })

export async function POST(request: NextRequest) {
  const r = await resolveToken()
  if (r.error) return r.error
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse('Invalid availability')
  try {
    await setAvailability(r.token, r.config.serverUrl!, r.config.accountId!, parsed.data.availability)
    return NextResponse.json({ ok: true, availability: parsed.data.availability })
  } catch {
    return errorResponse('Could not reach the chat server', 502)
  }
}
