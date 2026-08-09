import { createHmac } from 'node:crypto'

// Chatwoot "identity validation": the widget passes an identifier plus an
// HMAC-SHA256 of it keyed with the inbox's secret, so a visitor cannot claim
// to be someone else's email. Computed server-side only.
export function identifierHash(identifier: string, hmacToken: string): string {
  return createHmac('sha256', hmacToken).update(identifier).digest('hex')
}
