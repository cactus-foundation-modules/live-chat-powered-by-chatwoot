import { NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { listMachines } from '@/modules/live-chat/lib/fly'
import { backupStatus, machineHealth } from '@/modules/live-chat/lib/backups'
import { imageBuildStatus } from '@/modules/live-chat/lib/image-builds'

// One status read for the settings card: machine state, health, which Cactus
// build of the chat image is running against the newest one built, the latest
// upstream Chatwoot release, last backup.
export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const config = await getLiveChatConfig()
  const result: Record<string, unknown> = { configured: !!(config.serverUrl && config.accountId) }
  // What Fly says the machine is doing, read from Fly's own API - which does
  // not touch the machine. Null when there is no Fly token to ask with.
  let machineState: string | null = null

  if (config.flyToken && config.flyApp) {
    try {
      const machines = await listMachines(config.flyToken, config.flyApp)
      result.machines = machines.map((m) => ({
        id: m.id, name: m.name, state: m.state, region: m.region,
        image: m.config?.image ?? null,
      }))
      const first = machines[0]
      machineState = first?.state ?? null
      if (first) {
        try {
          result.imageBuild = await imageBuildStatus(first.config?.image ?? null, first.image_ref?.digest ?? null)
        } catch (err) {
          result.imageBuildError = err instanceof Error ? err.message : 'Image registry unreachable'
        }
      }
    } catch (err) {
      result.machinesError = err instanceof Error ? err.message : 'Fly API failed'
    }
  }

  // The health and last-backup reads go to the machine itself, through Fly's
  // proxy - and a request through the proxy wakes a sleeping machine. Asking
  // them whenever this card opened meant looking at the card woke the chat
  // server, so it only ever showed as awake. Asleep per Fly: say so and leave
  // it be (the card reads suspended/stopped as "asleep, wakes on demand").
  // Unknown (no Fly token): ask, as there is nothing else to go on.
  const asleep = machineState === 'suspended' || machineState === 'stopped'
  if (asleep) {
    result.healthy = false
    result.lastBackup = null
  } else {
    const [health, backup] = await Promise.all([machineHealth(), backupStatus()])
    result.healthy = health
    result.lastBackup = backup
  }

  try {
    const res = await fetch('https://api.github.com/repos/chatwoot/chatwoot/releases/latest', {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const json = await res.json() as { tag_name?: string }
      result.latestChatwoot = json.tag_name ?? null
    }
  } catch {
    result.latestChatwoot = null
  }

  return NextResponse.json(result)
}
