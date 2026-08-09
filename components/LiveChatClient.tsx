'use client'

import { useCallback, useEffect, useState } from 'react'
import { InboxCore } from './InboxCore'

const API_BASE = '/api/m/live-chat'

type Canned = { id: number; short_code: string; content: string }

export function LiveChatClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<'conversations' | 'canned'>('conversations')

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Live Chat</h1>
      </div>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        <button type="button" className={tab === 'conversations' ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setTab('conversations')}>Conversations</button>
        <button type="button" className={tab === 'canned' ? 'btn btn-primary btn-sm' : 'btn btn-sm'} onClick={() => setTab('canned')}>Canned Replies</button>
      </div>
      {tab === 'conversations' ? <InboxCore apiBase={API_BASE} /> : <CannedTab canManage={canManage} />}
    </div>
  )
}

function CannedTab({ canManage }: { canManage: boolean }) {
  const [canned, setCanned] = useState<Canned[]>([])
  const [editing, setEditing] = useState<{ id?: number; shortCode: string; content: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/canned`)
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Could not load canned replies')
      setCanned(json.canned ?? [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load canned replies')
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing) return
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/admin/canned`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setEditing(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this canned reply?')) return
    await fetch(`${API_BASE}/admin/canned?id=${id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  return (
    <div style={{ maxWidth: '46rem' }}>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
        Type <code>/</code> in any chat composer to insert one of these. Shortcodes work in the
        mobile app too - they live on the chat server.
      </p>
      {error && <div className="alert alert-danger" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}
      {canManage && !editing && (
        <button type="button" className="btn btn-primary btn-sm" style={{ marginBottom: '1rem' }}
          onClick={() => setEditing({ shortCode: '', content: '' })}>
          Add canned reply
        </button>
      )}
      {editing && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Shortcode</label>
            <input value={editing.shortCode} placeholder="delivery-times"
              onChange={(e) => setEditing({ ...editing, shortCode: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Reply text</label>
            <textarea rows={4} value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {canned.length === 0 && !editing ? (
        <div className="card">No canned replies yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {canned.map((c) => (
            <div key={c.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>/{c.short_code}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>{c.content}</div>
              </div>
              {canManage && (
                <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing({ id: c.id, shortCode: c.short_code, content: c.content })}>Edit</button>
                  <button type="button" className="btn btn-sm" onClick={() => remove(c.id)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
