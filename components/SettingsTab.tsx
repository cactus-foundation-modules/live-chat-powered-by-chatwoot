'use client'

import { useCallback, useEffect, useState } from 'react'

const API_BASE = '/api/m/live-chat'

type Settings = {
  serverUrl: string | null
  accountId: number | null
  inboxId: number | null
  websiteToken: string | null
  hasHmacToken: boolean
  hasApiToken: boolean
  hasWebhookToken: boolean
  flyApp: string | null
  hasFlyToken: boolean
  backupEndpoint: string | null
  hasBackupToken: boolean
  widgetPosition: 'left' | 'right'
  widgetLabel: string
  hideLabelOnMobile: boolean
  replyTimeText: string
  retentionMonths: number
  hasOwnAgentToken: boolean
  envProvided: string[]
  smtpConfigured: boolean
  chatLoginEmail: string | null
  hasChatLoginPassword: boolean
}

type Status = {
  configured: boolean
  healthy: boolean
  machines?: Array<{ id: string; name: string; state: string; region: string; image: string | null }>
  machinesError?: string
  lastBackup?: { state?: string; finished_at?: string; error?: string } | null
  latestChatwoot?: string | null
}

export function LiveChatSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [agentToken, setAgentToken] = useState('')
  const [widget, setWidget] = useState({ widgetPosition: 'right' as 'left' | 'right', widgetLabel: '', hideLabelOnMobile: false, replyTimeText: '', retentionMonths: 12 })
  const [prov, setProv] = useState({ flyToken: '', dbUrl: '', appName: '', running: false, step: '' })
  const [revealed, setRevealed] = useState<{ email: string; password: string | null } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/settings`)
      if (!res.ok) return
      const s = await res.json() as Settings
      setSettings(s)
      setWidget({ widgetPosition: s.widgetPosition, widgetLabel: s.widgetLabel, hideLabelOnMobile: s.hideLabelOnMobile, replyTimeText: s.replyTimeText, retentionMonths: s.retentionMonths })
    } catch { /* retry on next open */ }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/status`)
      if (res.ok) setStatus(await res.json() as Status)
    } catch { /* fine */ }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helpers; all setState calls are after awaits
  useEffect(() => { load(); loadStatus() }, [load, loadStatus])

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setMsg(okMsg)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveAgentToken() {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/admin/agent-token`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: agentToken }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Save failed')
      setMsg('Agent token saved - your replies now come from your own name.')
      setAgentToken('')
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function machineAction(action: 'wake' | 'update') {
    if (action === 'update' && !confirm('Update the chat server? A fresh backup is taken first and chat is offline for a minute or two while it restarts.')) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/admin/machine`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Failed')
      setMsg(action === 'wake' ? 'Waking the chat server…' : 'Update started - back in a minute or two.')
      setTimeout(loadStatus, 20_000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function syncEmail() {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/admin/sync-email`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Sync failed')
      setMsg('Email settings pushed - the chat server is restarting with email switched on.')
      setTimeout(loadStatus, 30_000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  async function provision(action: 'start' | 'step') {
    setProv((p) => ({ ...p, running: true }))
    setErr('')
    try {
      const body = action === 'start'
        ? { action, flyToken: prov.flyToken, dbUrl: prov.dbUrl, appName: prov.appName, region: 'lhr' }
        : { action }
      const res = await fetch(`${API_BASE}/admin/provision`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'Provisioning failed')
      const step = json.step as string
      setProv((p) => ({ ...p, step }))
      if (step !== 'done') {
        setTimeout(() => provision('step'), step === 'prepare-wait' ? 10_000 : 1500)
      } else {
        setMsg('Chat server built and connected. Your chat login (for the phone app) is shown in the "Chat server login" card above - and stays there. Next: add the Live Chat block to your site layout.')
        setProv((p) => ({ ...p, running: false }))
        load()
        loadStatus()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Provisioning failed')
      setProv((p) => ({ ...p, running: false }))
    }
  }

  if (!settings) return <div style={{ color: 'var(--color-text-muted)' }}>Loading…</div>

  const envManaged = settings.envProvided.length > 0
  const machine = status?.machines?.[0]
  const runningTag = machine?.image?.match(/:(v[\d.]+)-cactus/)?.[1] ?? null
  const updateAvailable = runningTag && status?.latestChatwoot && runningTag !== status.latestChatwoot

  return (
    <div style={{ maxWidth: '46rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {msg && <div className="alert alert-success" style={{ fontSize: '0.875rem' }}>{msg}</div>}
      {err && <div className="alert alert-danger" style={{ fontSize: '0.875rem' }}>{err}</div>}

      {settings.serverUrl && (
        <div className="card" style={{ background: 'var(--color-bg-subtle)' }}>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.25rem' }}>How live chat fits together</h3>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
            Everything day-to-day happens <strong>here in your admin</strong>: answering under Live Chat,
            these settings, backups on the Backup page. Underneath, a small separate <strong>chat engine</strong> runs
            at <a href={settings.serverUrl} target="_blank" rel="noreferrer noopener">{settings.serverUrl.replace(/^https?:\/\//, '')}</a> -
            you rarely visit it, but it is what the <strong>Chatwoot phone app</strong> signs into for
            push notifications on the go, using the chat login below.
          </p>
        </div>
      )}

      {settings.chatLoginEmail && (
        <div className="card">
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.25rem' }}>Chat server login</h3>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Used by the phone app (and the chat engine&apos;s own website, on the rare day you need it).
          </p>
          <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div>Email: <strong>{settings.chatLoginEmail}</strong></div>
            {revealed ? (
              <div>Password: <code>{revealed.password ?? 'held by your administrator - not stored on this site'}</code></div>
            ) : (
              <div>
                <button type="button" className="btn btn-sm" disabled={busy}
                  onClick={async () => {
                    const res = await fetch(`${API_BASE}/admin/chat-login`, { method: 'POST' })
                    if (res.ok) setRevealed(await res.json())
                  }}>
                  {settings.hasChatLoginPassword ? 'Reveal password' : 'Password details'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!settings.serverUrl && (
        <div className="card">
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.25rem' }}>Set up live chat</h3>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Paste a Fly.io API token and the connection URL of an <strong>empty</strong> Postgres
            database, and this builds your chat server automatically (a couple of minutes).
          </p>
          <div className="field"><label>Fly.io API token</label>
            <input type="password" value={prov.flyToken} onChange={(e) => setProv({ ...prov, flyToken: e.target.value })} /></div>
          <div className="field"><label>Empty database URL</label>
            <input value={prov.dbUrl} placeholder="postgres://user:pass@host:5432/chat" onChange={(e) => setProv({ ...prov, dbUrl: e.target.value })} /></div>
          <div className="field"><label>App name (becomes app-name.fly.dev)</label>
            <input value={prov.appName} placeholder="mysite-chat" onChange={(e) => setProv({ ...prov, appName: e.target.value })} /></div>
          <button type="button" className="btn btn-primary btn-sm" disabled={prov.running || !prov.flyToken || !prov.dbUrl || !prov.appName}
            onClick={() => provision('start')}>
            {prov.running ? `Building… (${prov.step || 'starting'})` : 'Build my chat server'}
          </button>
        </div>
      )}

      {settings.serverUrl && (
        <div className="card">
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.5rem' }}>Chat server</h3>
          <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div>Address: <a href={settings.serverUrl} target="_blank" rel="noreferrer noopener">{settings.serverUrl}</a></div>
            <div>Status: {status ? (status.healthy ? '🟢 healthy' : machine?.state === 'suspended' || machine?.state === 'stopped' ? '💤 asleep (wakes on demand)' : '🔴 unreachable') : '…'}</div>
            {machine && <div>Machine: {machine.state} in {machine.region.toUpperCase()}{runningTag ? ` · Chatwoot ${runningTag}` : ''}</div>}
            {status?.machinesError && <div style={{ color: 'var(--color-text-muted)' }}>Machine info unavailable: {status.machinesError}</div>}
            {status?.lastBackup?.state && (
              <div>Last backup: {status.lastBackup.state === 'ok' ? `✅ ${status.lastBackup.finished_at ?? ''}` : status.lastBackup.state}</div>
            )}
            {status?.latestChatwoot && (
              <div>
                Latest Chatwoot: {status.latestChatwoot}
                {updateAvailable ? ' - update available' : runningTag ? ' - up to date' : ''}
              </div>
            )}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.5rem 0' }}>
            Small security patches install themselves overnight. Bigger version jumps wait for the
            button below.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => machineAction('wake')}>Wake now</button>
            <button type="button" className="btn btn-sm" disabled={busy || !settings.hasFlyToken} onClick={() => machineAction('update')}>Update Chatwoot</button>
            <button type="button" className="btn btn-sm" disabled={busy || !settings.hasFlyToken} onClick={syncEmail}>Sync email to chat server</button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            {settings.smtpConfigured
              ? 'Email sync copies the SMTP details from Settings → Email across to the chat server (it restarts briefly), so it can email agents about missed messages.'
              : 'To let the chat server send email (missed-message alerts and the like), fill in the SMTP section under Settings → Email, deploy, then press "Sync email to chat server".'}
          </p>
          {envManaged && (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
              Connection settings on this install are managed centrally ({settings.envProvided.length} values from the environment), so there is nothing to fill in here.
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.25rem' }}>My agent identity</h3>
        {settings.hasOwnAgentToken ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Your personal token is saved - replies you send appear under your own name.
          </p>
        ) : (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            <p style={{ marginBottom: '0.5rem' }}>
              Right now your replies go out under the site&apos;s shared name. To send as yourself,
              fetch your personal token - it lives on the chat server&apos;s own website (not the phone app):
            </p>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <li>
                Open{' '}
                {settings.serverUrl ? (
                  <a href={settings.serverUrl} target="_blank" rel="noreferrer noopener">{settings.serverUrl.replace(/^https?:\/\//, '')}</a>
                ) : 'your chat server'}{' '}
                in a browser and sign in (same email and password as the phone app).
              </li>
              <li>Click your round profile picture in the bottom-left corner, then <strong>Profile Settings</strong>.</li>
              <li>Scroll to the bottom - <strong>Access Token</strong> - and press copy.</li>
              <li>Paste it below and save.</li>
            </ol>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input type="password" style={{ flex: 1 }} value={agentToken} placeholder="Paste your Access Token here"
            onChange={(e) => setAgentToken(e.target.value)} />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || agentToken.length < 10} onClick={saveAgentToken}>Save</button>
          {settings.hasOwnAgentToken && (
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={async () => { await fetch(`${API_BASE}/admin/agent-token`, { method: 'DELETE' }); load() }}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.75rem' }}>Widget</h3>
        <div className="field"><label>Bubble label</label>
          <input value={widget.widgetLabel} onChange={(e) => setWidget({ ...widget, widgetLabel: e.target.value })} /></div>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={widget.hideLabelOnMobile}
              onChange={(e) => setWidget({ ...widget, hideLabelOnMobile: e.target.checked })} />
            <span>Hide the label on phones</span>
          </label>
          <span className="field-hint">Leaves just the round chat icon on small screens, so the bubble stops sitting on top of buttons. Desktop keeps the words.</span>
        </div>
        <div className="field"><label>Reply-time expectation (shown on the bubble tooltip)</label>
          <input value={widget.replyTimeText} onChange={(e) => setWidget({ ...widget, replyTimeText: e.target.value })} /></div>
        <div className="field"><label>Corner</label>
          <select value={widget.widgetPosition} onChange={(e) => setWidget({ ...widget, widgetPosition: e.target.value as 'left' | 'right' })}>
            <option value="right">Bottom right</option>
            <option value="left">Bottom left</option>
          </select></div>
        <div className="field"><label>Delete closed conversations after (months)</label>
          <input type="number" min={1} max={120} value={widget.retentionMonths}
            onChange={(e) => setWidget({ ...widget, retentionMonths: parseInt(e.target.value) || 12 })} />
          <span className="field-hint">Keep this in step with what your privacy policy promises.</span></div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy}
          onClick={() => patch(widget, 'Widget settings saved.')}>Save widget settings</button>
      </div>
    </div>
  )
}
