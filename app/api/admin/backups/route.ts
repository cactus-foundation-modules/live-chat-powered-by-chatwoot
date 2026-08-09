import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { backupDownloadUrl, backupStatus, listBackups, triggerBackup } from '@/modules/live-chat/lib/backups'

export async function GET(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const file = request.nextUrl.searchParams.get('download')
  if (file) {
    const url = await backupDownloadUrl(file)
    if (!url) return errorResponse('Backup storage is not configured or the filename is invalid', 503)
    // Short-lived signed URL - the dump streams from B2, not through Vercel.
    return NextResponse.redirect(url)
  }

  const [backups, status] = await Promise.all([
    listBackups().catch(() => null),
    backupStatus(),
  ])
  return NextResponse.json({ backups, status })
}

export async function POST() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)

  const result = await triggerBackup()
  if (!result.ok) return errorResponse(result.error ?? 'Backup failed', 502)
  return NextResponse.json({ ok: true })
}
