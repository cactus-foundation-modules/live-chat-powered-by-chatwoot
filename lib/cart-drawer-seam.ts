// The shop's slide-out basket, as far as live chat needs to know about it.
//
// While the basket is open the chat bubble would sit over the panel's own
// buttons, so it steps aside, and the chat is offered inside the panel instead:
// a full-width button under "View full basket". Both halves go through two
// plain browser seams the basket publishes (the contract is written up in
// shop's components/public/cart-drawer-extras.ts):
//
// - the basket announces every open and shut on a window event, and parks the
//   latest answer on `window` for a widget that mounts after it opened;
// - it draws any component registered in a small registry on `window`, handing
//   it a `close` to shut the basket with.
//
// The names are declared here rather than imported: this module must build and
// run on a site with no shop at all, where that file does not exist. There,
// nothing ever announces a basket, the registry is never read, and the bubble
// behaves exactly as it always has.
//
// Plain module, no 'use client': see lib/unread.ts for why shared values live in
// one of these.
import type { ComponentType } from 'react'

const CART_DRAWER_STATE_EVENT = 'cactus-shop:cart-drawer'
const CART_DRAWER_OPEN_KEY = '__cactusCartDrawerOpen'
const CART_DRAWER_EXTRAS_EVENT = 'cactus-shop:cart-drawer-extras'
const CART_DRAWER_EXTRAS_KEY = '__cactusCartDrawerExtras'

export type CartDrawerExtraProps = { close: () => void }
type Extras = Readonly<Record<string, ComponentType<CartDrawerExtraProps>>>
type SeamWindow = { [CART_DRAWER_OPEN_KEY]?: boolean; [CART_DRAWER_EXTRAS_KEY]?: Extras }

const seam = () => window as unknown as SeamWindow

export function readCartDrawerOpen(): boolean {
  return seam()[CART_DRAWER_OPEN_KEY] === true
}

export function subscribeCartDrawerOpen(onChange: () => void): () => void {
  window.addEventListener(CART_DRAWER_STATE_EVENT, onChange)
  return () => window.removeEventListener(CART_DRAWER_STATE_EVENT, onChange)
}

// The registry is replaced whole on every change, never mutated, so the basket
// can hold the object it last read as a stable snapshot.
export function registerCartDrawerExtra(id: string, component: ComponentType<CartDrawerExtraProps>): () => void {
  seam()[CART_DRAWER_EXTRAS_KEY] = { ...(seam()[CART_DRAWER_EXTRAS_KEY] ?? {}), [id]: component }
  window.dispatchEvent(new Event(CART_DRAWER_EXTRAS_EVENT))
  return () => {
    const rest = { ...(seam()[CART_DRAWER_EXTRAS_KEY] ?? {}) }
    delete rest[id]
    seam()[CART_DRAWER_EXTRAS_KEY] = rest
    window.dispatchEvent(new Event(CART_DRAWER_EXTRAS_EVENT))
  }
}

// The wording on the basket's chat button: the bubble's own, which the widget
// knows and the button (drawn inside the basket's tree) does not. Published
// the same way the unread count is.
const CHAT_LABEL_EVENT = 'cactus-livechat:drawer-label'
let label = ''

export function readChatButtonLabel(): string {
  return label
}

export function publishChatButtonLabel(next: string): void {
  if (next === label) return
  label = next
  window.dispatchEvent(new Event(CHAT_LABEL_EVENT))
}

export function subscribeChatButtonLabel(onChange: () => void): () => void {
  window.addEventListener(CHAT_LABEL_EVENT, onChange)
  return () => window.removeEventListener(CHAT_LABEL_EVENT, onChange)
}
