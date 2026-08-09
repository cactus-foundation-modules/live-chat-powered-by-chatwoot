import { getLiveChatConfig } from './settings'

// ---------------------------------------------------------------------------
// Minimal Chatwoot REST client.
//
// Every call runs server-side with either the module's own API token or a
// specific admin's agent token (so replies attribute to the right person).
// The agent api_access_token never reaches the browser - the admin UI talks
// to module routes, module routes talk to Chatwoot.
// ---------------------------------------------------------------------------

export class ChatwootError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type CallOptions = {
  method?: string
  token?: string | null
  body?: unknown
  formData?: FormData
}

export async function chatwootApi<T = unknown>(path: string, opts: CallOptions = {}): Promise<T> {
  const config = await getLiveChatConfig()
  if (!config.serverUrl || !config.accountId) {
    throw new ChatwootError('Live chat is not configured yet', 503)
  }
  const token = opts.token ?? config.apiToken
  if (!token) throw new ChatwootError('No Chatwoot API token available', 503)

  const url = `${config.serverUrl.replace(/\/$/, '')}/api/v1/accounts/${config.accountId}${path}`
  const headers: Record<string, string> = { api_access_token: token }
  let body: BodyInit | undefined
  if (opts.formData) {
    body = opts.formData
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ChatwootError(`Chatwoot ${res.status}: ${text.slice(0, 300)}`, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// --- Conversations ---------------------------------------------------------

export async function sendMessage(
  conversationId: number,
  content: string,
  opts: { token?: string | null; files?: File[]; isPrivate?: boolean } = {}
): Promise<unknown> {
  if (opts.files && opts.files.length > 0) {
    const fd = new FormData()
    if (content) fd.append('content', content)
    fd.append('message_type', 'outgoing')
    if (opts.isPrivate) fd.append('private', 'true')
    for (const f of opts.files) fd.append('attachments[]', f, f.name)
    return chatwootApi(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      token: opts.token,
      formData: fd,
    })
  }
  return chatwootApi(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: opts.token,
    body: { content, message_type: 'outgoing', private: !!opts.isPrivate },
  })
}

export async function toggleConversationStatus(
  conversationId: number,
  status: 'open' | 'resolved',
  token?: string | null
): Promise<unknown> {
  return chatwootApi(`/conversations/${conversationId}/toggle_status`, {
    method: 'POST',
    token,
    body: { status },
  })
}

export async function markConversationRead(conversationId: number, token?: string | null): Promise<unknown> {
  return chatwootApi(`/conversations/${conversationId}/update_last_seen`, { method: 'POST', token })
}

// --- Canned responses ------------------------------------------------------

export type CannedResponse = { id: number; short_code: string; content: string }

export async function listCannedResponses(token?: string | null): Promise<CannedResponse[]> {
  return chatwootApi<CannedResponse[]>('/canned_responses', { token })
}

export async function createCannedResponse(shortCode: string, content: string, token?: string | null) {
  return chatwootApi('/canned_responses', {
    method: 'POST',
    token,
    body: { short_code: shortCode, content },
  })
}

export async function updateCannedResponse(id: number, shortCode: string, content: string, token?: string | null) {
  return chatwootApi(`/canned_responses/${id}`, {
    method: 'PATCH',
    token,
    body: { short_code: shortCode, content },
  })
}

export async function deleteCannedResponse(id: number, token?: string | null) {
  return chatwootApi(`/canned_responses/${id}`, { method: 'DELETE', token })
}

// --- Agent profile / realtime ---------------------------------------------

// The pubsub token is the limited credential Chatwoot's own dashboard uses for
// its WebSocket subscription. Safe to hand to the admin's browser; the full
// agent token is not.
export async function getProfilePubsubToken(agentToken: string, serverUrl: string): Promise<{ pubsubToken: string; accountId: number; agentId: number }> {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/profile`, {
    headers: { api_access_token: agentToken },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new ChatwootError(`Chatwoot profile ${res.status}`, res.status)
  const json = await res.json() as { pubsub_token: string; account_id: number; id: number }
  return { pubsubToken: json.pubsub_token, accountId: json.account_id, agentId: json.id }
}

export async function setAvailability(agentToken: string, serverUrl: string, accountId: number, availability: 'online' | 'offline' | 'busy') {
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/profile/availability`, {
    method: 'POST',
    headers: { api_access_token: agentToken, 'content-type': 'application/json' },
    body: JSON.stringify({ availability, account_id: accountId }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new ChatwootError(`Chatwoot availability ${res.status}`, res.status)
  return res.json()
}

// --- Contact deletion (GDPR erasure) ---------------------------------------

export async function searchContactsByEmail(email: string, token?: string | null): Promise<Array<{ id: number; email: string | null }>> {
  const result = await chatwootApi<{ payload: Array<{ id: number; email: string | null }> }>(
    `/contacts/search?q=${encodeURIComponent(email)}`,
    { token }
  )
  return result.payload ?? []
}

export async function deleteContact(contactId: number, token?: string | null) {
  return chatwootApi(`/contacts/${contactId}`, { method: 'DELETE', token })
}
