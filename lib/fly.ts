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
