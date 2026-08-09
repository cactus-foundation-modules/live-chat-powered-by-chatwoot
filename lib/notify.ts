// One rolling "N unread live chats" notification in the core admin bell,
// contact-form's syncMessagesNotification pattern exactly: raised/updated
// while any conversation holds unread customer messages, cleared at zero.
// Fire-and-forget from every mutation that moves the unread count.
import { upsertAlert, clearAlert } from '@/lib/notifications/alerts'
import { totalUnread } from './db'

const DEDUPE_KEY = 'live-chat:unread'

export async function syncChatNotification(): Promise<void> {
  const n = await totalUnread()

  if (n > 0) {
    await upsertAlert({
      type: 'message',
      dedupeKey: DEDUPE_KEY,
      title: `${n} unread live chat${n === 1 ? '' : 's'}`,
      link: '/m/live-chat/live-chat',
    })
  } else {
    await clearAlert(DEDUPE_KEY)
  }
}
