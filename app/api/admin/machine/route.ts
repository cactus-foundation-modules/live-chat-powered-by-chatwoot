import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig } from '@/modules/live-chat/lib/settings'
import { listMachines, startMachine, updateMachineImage } from '@/modules/live-chat/lib/fly'
import { triggerBackup } from '@/modules/live-chat/lib/backups'

// Manual machine actions. "update" is the manual "Update Chatwoot" button:
// dump the database first, then swap the machine to the newest built image -
// Fly re-resolves the tag's digest, the machine restarts, Chatwoot migrates on
// boot. Automatic PATCH updates happen upstream in the image repo's workflow.
const Body = z.object({ action: z.enum(['wake', 'update']) })

export async function POST(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse('Invalid action')

  const config = await getLiveChatConfig()
  if (!config.flyToken || !config.flyApp) return errorResponse('Fly access is not configured', 503)

  try {
    const machines = await listMachines(config.flyToken, config.flyApp)
    const machine = machines[0]
    if (!machine) return errorResponse('No machine found on the app', 404)

    if (parsed.data.action === 'wake') {
      if (machine.state !== 'started') await startMachine(config.flyToken, config.flyApp, machine.id)
      return NextResponse.json({ ok: true, state: 'starting' })
    }

    // update
    const backup = await triggerBackup()
    if (!backup.ok && backup.error !== 'A backup is already running') {
      return errorResponse(`Refusing to update without a fresh backup: ${backup.error}`, 503)
    }
    const image = machine.config?.image?.replace(/:.+$/, ':latest') ?? null
    if (!image) return errorResponse('Cannot work out the image to update to', 500)
    await updateMachineImage(config.flyToken, config.flyApp, machine.id, image)
    return NextResponse.json({ ok: true, updatedTo: image })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Fly API failed', 502)
  }
}
