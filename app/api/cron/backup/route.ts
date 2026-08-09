import { NextRequest, NextResponse } from 'next/server'
import { triggerBackup } from '@/modules/live-chat/lib/backups'

// Nightly Vercel cron. The HTTPS call to the backup endpoint wakes a suspended
// machine, which is exactly what makes overnight backups reliable despite
// auto-suspend.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }
  const result = await triggerBackup()
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
