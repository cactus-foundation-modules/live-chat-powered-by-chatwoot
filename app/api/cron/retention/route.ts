import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { deleteConversationsOlderThan } from '@/modules/live-chat/lib/db'
import { chatwootApi } from '@/modules/live-chat/lib/chatwoot'

// Retention: the privacy policy promises chats are deleted 12 months after
// they close (configurable, default 12). Deletes on the Chatwoot server first,
// then the local mirror rows (cascade handles messages).
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const config = await getLiveChatConfig()
  const months = config.retentionMonths

  let chatwootDeleted = 0
  try {
    // Chatwoot has no bulk delete-by-age; walk resolved conversations and
    // delete the stale ones. Page size kept small - this runs nightly, the
    // backlog never grows past a day's worth after the first sweep.
    const cutoff = Date.now() - months * 30.44 * 24 * 3600 * 1000
    for (let page = 1; page <= 20; page++) {
      const result = await chatwootApi<{ data: { payload: Array<{ id: number; last_activity_at: number }> } }>(
        `/conversations?status=resolved&page=${page}&sort_by=last_activity_at_asc`
      )
      const conversations = result.data?.payload ?? []
      if (conversations.length === 0) break
      const stale = conversations.filter((c) => c.last_activity_at * 1000 < cutoff)
      for (const c of stale) {
        await chatwootApi(`/conversations/${c.id}`, { method: 'DELETE' })
        chatwootDeleted++
      }
      // Oldest-first sort: the first page with nothing stale means we're done.
      if (stale.length < conversations.length) break
    }
  } catch {
    // Chatwoot unreachable (machine asleep and slow to wake, say) - the mirror
    // sweep below still runs; the server side catches up on the next night.
  }

  const mirrorDeleted = await deleteConversationsOlderThan(months)
  return NextResponse.json({ ok: true, chatwootDeleted, mirrorDeleted, months })
}
