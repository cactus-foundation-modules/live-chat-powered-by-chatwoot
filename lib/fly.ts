// Minimal Fly Machines API client - machine status, wake, and image update.
// Used by the settings tab's status card and the manual "Update Chatwoot"
// button. The token is app-scoped; self-serve installs supply their own.

const FLY_API = 'https://api.machines.dev/v1'

export type FlyMachine = {
  id: string
  name: string
  state: string
  region: string
  config?: { image?: string }
}

async function flyApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${FLY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Fly API ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export async function listMachines(token: string, app: string): Promise<FlyMachine[]> {
  return flyApi<FlyMachine[]>(token, `/apps/${app}/machines`)
}

export async function getMachine(token: string, app: string, machineId: string): Promise<FlyMachine & { config: Record<string, unknown> }> {
  return flyApi(token, `/apps/${app}/machines/${machineId}`)
}

export async function startMachine(token: string, app: string, machineId: string): Promise<void> {
  await flyApi(token, `/apps/${app}/machines/${machineId}/start`, { method: 'POST' })
}

export async function restartMachine(token: string, app: string, machineId: string): Promise<void> {
  await flyApi(token, `/apps/${app}/machines/${machineId}/restart`, { method: 'POST' })
}

// App secrets for a machines-first app go through GraphQL (the REST surface has
// no equivalent); they're staged and picked up when a machine (re)starts.
export async function setAppSecrets(token: string, app: string, secrets: Record<string, string>): Promise<void> {
  const res = await fetch('https://api.fly.io/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation($input: SetSecretsInput!) { setSecrets(input: $input) { app { name } } }',
      variables: { input: { appId: app, secrets: Object.entries(secrets).map(([key, value]) => ({ key, value })) } },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const json = await res.json().catch(() => null) as { errors?: Array<{ message: string }> } | null
  if (!res.ok || json?.errors?.length) {
    throw new Error(`Fly setSecrets: ${json?.errors?.[0]?.message ?? res.status}`)
  }
}

// Image swap preserving the rest of the machine config. Fly restarts the
// machine with the new image; Chatwoot's entrypoint migrates on boot.
export async function updateMachineImage(token: string, app: string, machineId: string, image: string): Promise<void> {
  const machine = await getMachine(token, app, machineId)
  const config = { ...(machine.config as Record<string, unknown>), image }
  await flyApi(token, `/apps/${app}/machines/${machineId}`, {
    method: 'POST',
    body: JSON.stringify({ config }),
  })
}
