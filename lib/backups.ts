import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getLiveChatConfig } from './settings'

// Chatwoot database dumps: made by the machine's backup endpoint (pg_dump on
// board, shipped to B2), listed and downloaded here for the core backup page.
// The bucket path lives in env alongside the other LIVECHAT_* values.

export type BackupEntry = { key: string; file: string; size: number; lastModified: Date | null }

function b2() {
  const endpoint = process.env.LIVECHAT_B2_ENDPOINT
  const keyId = process.env.LIVECHAT_B2_KEY_ID
  const key = process.env.LIVECHAT_B2_KEY
  if (!endpoint || !keyId || !key) return null
  return new S3Client({
    endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
    region: endpoint.match(/s3\.([a-z0-9-]+)\./)?.[1] ?? 'eu-central-003',
    credentials: { accessKeyId: keyId, secretAccessKey: key },
  })
}

function bucketAndPrefix(): { bucket: string; prefix: string } | null {
  const raw = process.env.LIVECHAT_BACKUP_BUCKET_PATH
  if (!raw) return null
  const [bucket, ...rest] = raw.split('/')
  if (!bucket) return null
  return { bucket, prefix: rest.join('/') }
}

export async function listBackups(): Promise<BackupEntry[] | null> {
  const client = b2()
  const loc = bucketAndPrefix()
  if (!client || !loc) return null
  const result = await client.send(new ListObjectsV2Command({
    Bucket: loc.bucket,
    Prefix: `${loc.prefix}/`,
    MaxKeys: 100,
  }))
  return (result.Contents ?? [])
    .filter((o) => !!o.Key && o.Key !== `${loc.prefix}/`)
    .map((o) => ({
      key: o.Key as string,
      file: (o.Key as string).slice(loc.prefix.length + 1),
      size: o.Size ?? 0,
      lastModified: o.LastModified ?? null,
    }))
    .sort((a, b) => (b.file < a.file ? -1 : 1))
}

// Short-lived signed download URL - the dump never streams through a Vercel
// function, the browser fetches it straight from B2.
export async function backupDownloadUrl(file: string): Promise<string | null> {
  const client = b2()
  const loc = bucketAndPrefix()
  if (!client || !loc) return null
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return null
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: loc.bucket,
    Key: `${loc.prefix}/${file}`,
  }), { expiresIn: 300 })
}

// --- Machine backup endpoint ------------------------------------------------

export type BackupStatus = Record<string, unknown> & { state?: string }

export async function triggerBackup(): Promise<{ ok: boolean; error?: string }> {
  const config = await getLiveChatConfig()
  if (!config.backupEndpoint || !config.backupToken) return { ok: false, error: 'Backup endpoint not configured' }
  const res = await fetch(`${config.backupEndpoint.replace(/\/$/, '')}/backup`, {
    method: 'POST',
    headers: { 'X-Backup-Token': config.backupToken },
    signal: AbortSignal.timeout(45_000),
    cache: 'no-store',
  })
  if (res.status === 409) return { ok: false, error: 'A backup is already running' }
  if (!res.ok) return { ok: false, error: `Backup endpoint returned ${res.status}` }
  return { ok: true }
}

export async function backupStatus(): Promise<BackupStatus | null> {
  const config = await getLiveChatConfig()
  if (!config.backupEndpoint || !config.backupToken) return null
  try {
    const res = await fetch(`${config.backupEndpoint.replace(/\/$/, '')}/backup/status`, {
      headers: { 'X-Backup-Token': config.backupToken },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json() as BackupStatus
  } catch {
    return null
  }
}

export async function machineHealth(): Promise<boolean> {
  const config = await getLiveChatConfig()
  if (!config.backupEndpoint) return false
  try {
    const res = await fetch(`${config.backupEndpoint.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
