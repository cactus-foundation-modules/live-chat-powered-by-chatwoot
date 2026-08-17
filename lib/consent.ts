// The cookie consent category this module asks a site to carry. It is
// suggested to the owner on the admin's GDPR tab (cactus.module.json's
// cookieCategories), checked server-side when deciding whether chat is gated,
// and read client-side before anything chat-related is shown or stored.
//
// Keys are machine-readable by contract with core: lowercase, starting with a
// letter, letters/numbers/hyphens/underscores only. The human wording lives on
// the site's own category row, so owners can reword it without breaking this.
export const CONSENT_CATEGORY = 'live-chat'

// Set by core's consent banner on every decision, and the event it announces
// them with. Read through casts rather than re-declared: core owns the types.
export const CONSENT_CHANGE_EVENT = 'cactus:consent-change'

export function consentMap(): Record<string, boolean> | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { __cactusConsent?: Record<string, boolean> }).__cactusConsent
}

// True only once the visitor has actually granted the category. A visitor who
// has not answered the banner has no decision recorded at all, so this is
// false for them too - which is the point.
export function chatConsentGranted(): boolean {
  return consentMap()?.[CONSENT_CATEGORY] === true
}

// Core writes its decision cookie on every choice, so whether that cookie exists
// separates "asked and said no to live chat" from "has not been asked yet" - a
// distinction window.__cactusConsent deliberately flattens, since both deny.
// Only the cookie's existence is read here; what is inside it is core's business.
const CONSENT_COOKIE = 'cactus-consent'

export function consentAnswered(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${CONSENT_COOKIE}=`))
}

// Re-opens core's consent banner on its manage view, pre-filled with whatever the
// visitor chose last time. Optional-chained throughout: on a site with no banner
// the global is a no-op stub, and chat is not gated there anyway.
export function openConsentSettings(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as { cactusConsent?: { open?: () => void } }).cactusConsent?.open?.()
}
