'use client'

import { useCallback, useEffect, useState } from 'react'

const API_BASE = '/api/m/live-chat'

type BackupEntry = { key: string; file: string; size: number; lastModified: string | null }
type BackupStatus = { state?: string; file?: string; finished_at?: string; error?: string } | null

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n > 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

// Card under core Settings > Backup (core.backup-page extension point): the
// live-chat conversations live in their own database on the chat server, so
// they get their own dumps - listed here, next to the site backup, where
// nobody forgets they exist.
export function LiveChatBackupCard() {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null)
  const [status, setStatus] = useState<BackupStatus>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/backups`)
      if (!res.ok) return
      const json = await res.json() as { backups: BackupEntry[] | null; status: BackupStatus }
      setBackups(json.backups)
      setStatus(json.status)
    } catch { /* leave as-is */ }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { load() }, [load])

  async function backupNow() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/admin/backups`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Backup failed to start')
      setTimeout(load, 20_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed to start')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
      <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.25rem' }}>Live chat backups</h3>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
        Chat conversations live on your chat server, in their own database - so they get their own
        backups. One is taken automatically every night; the newest 30 are kept.
      </p>
      {error && <div className="alert alert-danger" style={{ marginBottom: '0.75rem', fontSize: '0.8125rem' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={backupNow}>
          {busy ? 'Starting…' : 'Back up now'}
        </button>
        {status?.state === 'running' && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>backup running…</span>}
        {status?.state === 'error' && <span style={{ fontSize: '0.8125rem', color: 'var(--color-danger, #b91c1c)' }}>last run failed: {status.error}</span>}
      </div>
      {backups === null ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          Backup storage is not configured on this install.
        </div>
      ) : backups.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No chat backups yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '12rem', overflowY: 'auto' }}>
          {backups.map((b) => (
            <div key={b.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.8125rem' }}>
              <a href={`${API_BASE}/admin/backups?download=${encodeURIComponent(b.file)}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.file}
              </a>
              <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{fmtBytes(b.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
