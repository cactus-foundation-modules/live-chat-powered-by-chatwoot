import { prisma } from '@/lib/db/prisma'
import { anyAgentOnline } from './chatwoot'

// ---------------------------------------------------------------------------
// "Is anybody on the chat?", answered from the site's own database.
//
// The public side asks this on every page view (online bubble or away bubble).
// Asking the chat server instead woke it from sleep every time, so it never
// slept. The value is written whenever availability changes through Cactus -
// the Online/Offline switch - and read here for free.
//
// Known gap: an agent who flips availability in Chatwoot's own app rather than
// the Cactus switch is not seen until someone next opens the Cactus inbox,
// which re-reads the live value (see refreshAgentOnline). Chatwoot sends no
// webhook for availability, so there is nothing to listen to.
// ---------------------------------------------------------------------------

export async function readAgentOnline(): Promise<boolean | null> {
  const rows = await prisma.$queryRaw<Array<{ agent_online: boolean | null }>>`
    SELECT "agent_online" FROM "lc_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return rows[0]?.agent_online ?? null
}

export async function storeAgentOnline(online: boolean): Promise<void> {
  // Upsert: an install configured wholly by LIVECHAT_* env vars may never have
  // written a settings row, and every other column has a default.
  await prisma.$executeRaw`
    INSERT INTO "lc_settings" ("id", "agent_online", "agent_online_at")
    VALUES ('singleton', ${online}, now())
    ON CONFLICT ("id") DO UPDATE SET
      "agent_online" = EXCLUDED."agent_online",
      "agent_online_at" = EXCLUDED."agent_online_at"
  `
}

// Ask the chat server who is on and record it. Only for moments when the
// server is being talked to anyway (availability switched, inbox opened, the
// one-off first read after this landed) - never on a visitor's page view.
export async function refreshAgentOnline(): Promise<boolean> {
  const online = await anyAgentOnline()
  await storeAgentOnline(online)
  return online
}
