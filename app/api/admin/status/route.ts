import { NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { listMachines } from '@/modules/live-chat/lib/fly'
import { backupStatus, machineHealth } from '@/modules/live-chat/lib/backups'

// One status read for the settings card: machine state, health, running
// Chatwoot version (from the image tag), latest upstream release, last backup.
export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const config = await getLiveChatConfig()
  const result: Record<string, unknown> = { configured: !!(config.serverUrl && config.accountId) }

  if (config.flyToken && config.flyApp) {
    try {
      const machines = await listMachines(config.flyToken, config.flyApp)
      result.machines = machines.map((m) => ({
        id: m.id, name: m.name, state: m.state, region: m.region,
        image: m.config?.image ?? null,
      }))
    } catch (err) {
      result.machinesError = err instanceof Error ? err.message : 'Fly API failed'
    }
  }

  const [health, backup] = await Promise.all([machineHealth(), backupStatus()])
  result.healthy = health
  result.lastBackup = backup

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
