import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Client as PgClient } from 'pg'
import { prisma } from '@/lib/db/prisma'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getLiveChatConfig, updateSettings } from '@/modules/live-chat/lib/settings'

// Self-serve provisioning: a site owner pastes a Fly.io API token and a
// connection URL to an EMPTY Postgres database, and this route builds the
// whole chat server - one step per call, so no step ever fights the module
// route time ceiling. The admin UI calls POST repeatedly; each response names
// the next step. State survives in lc_settings.provision_state.
//
// Deskwell never runs this - its machine was provisioned by hand and its
// config arrives via LIVECHAT_* env vars.

const FLY_API = 'https://api.machines.dev/v1'
const IMAGE = 'registry.fly.io/deskwell-chat:latest' // public per-install images can replace this later

type ProvisionState = {
  step: string
  flyToken?: string
  dbUrl?: string
  appName?: string
  region?: string
  volumeId?: string
  prepareMachineId?: string
  machineId?: string
  secretKeyBase?: string
  webhookToken?: string
  backupToken?: string
  error?: string
}

async function fly<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${FLY_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(40_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Fly ${path} -> ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res.status === 204 ? (undefined as T) : res.json() as Promise<T>
}

async function flyGraphql(token: string, query: string, variables: Record<string, unknown>): Promise<void> {
  const res = await fetch('https://api.fly.io/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(40_000),
  })
  const json = await res.json().catch(() => null) as { errors?: Array<{ message: string }> } | null
  if (!res.ok || json?.errors?.length) {
    throw new Error(`Fly GraphQL: ${json?.errors?.[0]?.message ?? res.status}`)
  }
}

function machineEnv(state: ProvisionState, siteUrl: string): Record<string, string> {
  return {
    RAILS_ENV: 'production', NODE_ENV: 'production', RAILS_LOG_TO_STDOUT: 'true',
    SECRET_KEY_BASE: state.secretKeyBase!,
    FRONTEND_URL: `https://${state.appName}.fly.dev`,
    DATABASE_URL: state.dbUrl!,
    REDIS_URL: 'redis://127.0.0.1:6379',
    ACTIVE_STORAGE_SERVICE: 'local',
    ENABLE_ACCOUNT_SIGNUP: 'false',
    INSTALLATION_NAME: new URL(siteUrl).hostname,
    BACKUP_TOKEN: state.backupToken!,
  }
}

const StartBody = z.object({
  action: z.literal('start'),
  flyToken: z.string().min(10),
  dbUrl: z.string().url().startsWith('postgres'),
  appName: z.string().regex(/^[a-z][a-z0-9-]{3,28}$/, 'App name: lowercase letters, numbers, dashes'),
  region: z.string().regex(/^[a-z]{3}$/).default('lhr'),
})
const StepBody = z.object({ action: z.literal('step') })
const ResetBody = z.object({ action: z.literal('reset') })
const Body = z.union([StartBody, StepBody, ResetBody])

export async function POST(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'livechat.manage')) return errorResponse('Forbidden', 403)
  if (!process.env.ENCRYPTION_KEY) return errorResponse('ENCRYPTION_KEY is not set', 503)

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')

  const config = await getLiveChatConfig()
  const rows = await prisma.$queryRaw<Array<{ provision_state: unknown }>>`
    SELECT "provision_state" FROM "lc_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  let state = (rows[0]?.provision_state ?? null) as ProvisionState | null

  if (parsed.data.action === 'reset') {
    await updateSettings({ provisionState: null })
    return NextResponse.json({ ok: true, step: 'idle' })
  }

  if (parsed.data.action === 'start') {
    if (config.serverUrl) return errorResponse('Live chat is already configured')
    const { flyToken, dbUrl, appName, region } = parsed.data
    // Validate the database: reachable and empty.
    const pg = new PgClient({ connectionString: dbUrl, ssl: dbUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 15_000 })
    try {
      await pg.connect()
      const r = await pg.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`)
      if (r.rows[0].n > 0) return errorResponse('That database is not empty - chat needs a brand new one')
    } catch (err) {
      return errorResponse(`Could not reach that database: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      await pg.end().catch(() => {})
    }
    // Validate the Fly token by listing apps.
    try {
      await fly(flyToken, `/apps?org_slug=personal`)
    } catch {
      return errorResponse('Fly.io rejected that token')
    }
    state = {
      step: 'create-app', flyToken, dbUrl, appName, region,
      secretKeyBase: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
      webhookToken: crypto.randomUUID().replaceAll('-', ''),
      backupToken: crypto.randomUUID().replaceAll('-', ''),
    }
    await updateSettings({ provisionState: state })
    return NextResponse.json({ ok: true, step: state.step })
  }

  // action === 'step'
  if (!state || !state.step || state.step === 'done') return errorResponse('Nothing in progress - start first')
  const siteUrl = process.env.SITE_URL ?? 'https://example.invalid'

  try {
    switch (state.step) {
      case 'create-app': {
        await fly(state.flyToken!, '/apps', {
          method: 'POST',
          body: JSON.stringify({ app_name: state.appName, org_slug: 'personal' }),
        })
        state.step = 'volume'
        break
      }
      case 'volume': {
        const vol = await fly<{ id: string }>(state.flyToken!, `/apps/${state.appName}/volumes`, {
          method: 'POST',
          body: JSON.stringify({ name: 'chatwoot_data', region: state.region, size_gb: 3 }),
        })
        state.volumeId = vol.id
        state.step = 'prepare'
        break
      }
      case 'prepare': {
        const machine = await fly<{ id: string }>(state.flyToken!, `/apps/${state.appName}/machines`, {
          method: 'POST',
          body: JSON.stringify({
            name: 'prepare',
            region: state.region,
            config: {
              image: IMAGE,
              guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 2048 },
              env: machineEnv(state, siteUrl),
              auto_destroy: true,
              restart: { policy: 'no' },
              processes: [{ name: 'prepare', cmd: ['sh', '-c', 'redis-server --daemonize yes --port 6379 && sleep 2 && bundle exec rails db:chatwoot_prepare'] }],
            },
          }),
        })
        state.prepareMachineId = machine.id
        state.step = 'prepare-wait'
        break
      }
      case 'prepare-wait': {
        try {
          const m = await fly<{ state: string }>(state.flyToken!, `/apps/${state.appName}/machines/${state.prepareMachineId}`)
          if (m.state === 'stopped' || m.state === 'destroyed') state.step = 'machine'
          // else stay on prepare-wait; the UI polls again
        } catch {
          state.step = 'machine' // machine gone = auto-destroyed after finishing
        }
        break
      }
      case 'machine': {
        const machine = await fly<{ id: string }>(state.flyToken!, `/apps/${state.appName}/machines`, {
          method: 'POST',
          body: JSON.stringify({
            name: 'chatwoot',
            region: state.region,
            config: {
              image: IMAGE,
              guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 2048 },
              env: machineEnv(state, siteUrl),
              mounts: [{ volume: state.volumeId, path: '/data' }],
              services: [
                { internal_port: 3000, protocol: 'tcp', autostop: 'suspend', autostart: true, min_machines_running: 0,
                  ports: [{ port: 443, handlers: ['tls', 'http'] }, { port: 80, handlers: ['http'], force_https: true }] },
                { internal_port: 8081, protocol: 'tcp', autostop: 'suspend', autostart: true,
                  ports: [{ port: 8443, handlers: ['tls', 'http'] }] },
              ],
              processes: [
                { name: 'redis', cmd: ['sh', '-c', 'mkdir -p /data/redis && exec redis-server --dir /data/redis --appendonly yes --bind 127.0.0.1 --port 6379'] },
                { name: 'web', cmd: ['sh', '-c', 'mkdir -p /app/tmp/pids /app/tmp/cache && rm -f /app/tmp/pids/server.pid && mkdir -p /data/storage && rm -rf /app/storage && ln -sfn /data/storage /app/storage && exec bundle exec rails s -p 3000 -b 0.0.0.0'] },
                { name: 'worker', cmd: ['sh', '-c', 'sleep 3; exec bundle exec sidekiq -C config/sidekiq.yml'] },
                { name: 'backupd', cmd: ['sh', '-c', 'cd /cactus && BUNDLE_GEMFILE=/app/Gemfile exec bundle exec puma -p 8081 backup.ru'] },
              ],
              restart: { policy: 'on-failure', max_retries: 3 },
            },
          }),
        })
        state.machineId = machine.id
        state.step = 'ips'
        break
      }
      case 'ips': {
        const q = `mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { ipAddress { address } } }`
        await flyGraphql(state.flyToken!, q, { input: { appId: state.appName, type: 'shared_v4' } })
        await flyGraphql(state.flyToken!, q, { input: { appId: state.appName, type: 'v6' } })
        state.step = 'seed'
        break
      }
      case 'seed': {
        const script = [
          `require 'json'`,
          `account = Account.find_by(name: 'Site') || Account.create!(name: 'Site')`,
          `channel = nil`,
          `inbox = account.inboxes.find_by(name: 'Website')`,
          `if inbox.nil?`,
          `  channel = Channel::WebWidget.create!(account: account, website_url: '${siteUrl}', pre_chat_form_enabled: true)`,
          `  inbox = Inbox.create!(account: account, channel: channel, name: 'Website', greeting_enabled: false)`,
          `end`,
          `channel = inbox.channel`,
          `wh = '${siteUrl.replace(/\/$/, '')}/api/m/live-chat/webhook?token=${state.webhookToken}'`,
          `account.webhooks.create!(url: wh, subscriptions: %w[conversation_created conversation_status_changed conversation_updated message_created message_updated]) unless account.webhooks.exists?(url: wh)`,
          `puts '===R===' + JSON.generate({account_id: account.id, inbox_id: inbox.id, website_token: channel.website_token, hmac_token: channel.hmac_token})`,
        ].join('\n')
        const b64 = Buffer.from(script, 'utf8').toString('base64')
        const env = machineEnv(state, siteUrl)
        const envPrefix = Object.entries(env).map(([k, v]) => `${k}='${v}'`).join(' ')
        const exec = await fly<{ stdout?: string; stderr?: string; exit_code?: number }>(
          state.flyToken!, `/apps/${state.appName}/machines/${state.machineId}/exec`, {
            method: 'POST',
            body: JSON.stringify({ command: ['sh', '-c', `echo ${b64} | base64 -d > /tmp/seed.rb && cd /app && ${envPrefix} bundle exec rails runner /tmp/seed.rb`], timeout: 55 }),
          })
        const match = (exec.stdout ?? '').match(/===R===(\{.*\})/)
        if (!match?.[1]) throw new Error(`Seed did not finish: ${(exec.stderr ?? exec.stdout ?? '').slice(-200)}`)
        const seeded = JSON.parse(match[1]) as { account_id: number; inbox_id: number; website_token: string; hmac_token: string }
        await updateSettings({
          serverUrl: `https://${state.appName}.fly.dev`,
          accountId: seeded.account_id,
          inboxId: seeded.inbox_id,
          websiteToken: seeded.website_token,
          hmacToken: seeded.hmac_token,
          webhookToken: state.webhookToken,
          flyApp: state.appName,
          flyToken: state.flyToken,
          backupEndpoint: `https://${state.appName}.fly.dev:8443`,
          backupToken: state.backupToken,
        })
        state.step = 'done'
        break
      }
      default:
        return errorResponse(`Unknown step ${state.step}`)
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'step failed'
    await updateSettings({ provisionState: state })
    return errorResponse(state.error, 502)
  }

  delete state.error
  // The seed step stored real settings; scrub the fly token out of state once done.
  const persisted: ProvisionState = state.step === 'done' ? { step: 'done' } : state
  await updateSettings({ provisionState: persisted })
  return NextResponse.json({ ok: true, step: state.step })
}
