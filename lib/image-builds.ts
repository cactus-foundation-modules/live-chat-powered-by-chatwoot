import { z } from 'zod'

// Which Cactus build of the chat image is newest, and which one a machine is
// actually running.
//
// The image repo (cactus-foundation-modules/chatwoot-image) tags every build
// `<chatwoot version>-cactus.<build number>` and pushes it, plus `latest`, to
// the public GHCR image and to the Fly registry from the same workflow run. So
// a Cactus-only change (a widget CSS tweak, say) is a new build with the same
// Chatwoot version - comparing Chatwoot versions alone called that "up to
// date". The build number is what moves, so that is what is compared.
//
// Read from GHCR's registry API with an anonymous pull token: the image is
// public, and this spends nothing from anyone's GitHub API allowance. Answers
// are kept in memory for a few minutes rather than in the fetch cache, which
// keys on headers and so would miss every time the short-lived token changes.

export const CACTUS_IMAGE_REPO = 'cactus-foundation-modules/chatwoot'
const GHCR = 'https://ghcr.io'
const CACHE_MS = 10 * 60_000

const memo = new Map<string, { at: number; value: unknown }>()

async function remembered<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T
  const value = await load()
  memo.set(key, { at: Date.now(), value })
  return value
}

const CACTUS_TAG = /^(v\d+\.\d+\.\d+)-cactus\.(\d+)$/

export type CactusBuild = { tag: string; chatwoot: string; build: number }

export function parseCactusTag(tag: string): CactusBuild | null {
  const m = CACTUS_TAG.exec(tag)
  if (!m?.[1] || !m[2]) return null
  return { tag, chatwoot: m[1], build: Number(m[2]) }
}

export function compareChatwootVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// Build numbers come from one workflow's run counter, so they only ever climb;
// the Chatwoot version leads anyway so a manual rebuild of an older release
// can never outrank a newer one.
export function compareBuilds(a: CactusBuild, b: CactusBuild): number {
  return compareChatwootVersions(a.chatwoot, b.chatwoot) || a.build - b.build
}

// "registry/path:tag" or "registry/path@sha256:..." -> its parts. The tag is
// null for a digest reference or a bare name.
export function splitImageRef(image: string): { repo: string; tag: string | null } {
  const at = image.indexOf('@')
  if (at !== -1) return { repo: image.slice(0, at), tag: null }
  const slash = image.lastIndexOf('/')
  const colon = image.lastIndexOf(':')
  if (colon > slash) return { repo: image.slice(0, colon), tag: image.slice(colon + 1) }
  return { repo: image, tag: null }
}

// The images this lookup speaks for: the public GHCR image, and any other
// registry's copy that carries the same `-cactus.N` tags (the Fly registry
// copy the original install runs). A hand-supplied image with its own tagging
// is left alone - its builds are not ours to number.
export function isCactusImage(image: string): boolean {
  const { repo, tag } = splitImageRef(image)
  if (repo === `ghcr.io/${CACTUS_IMAGE_REPO}`) return true
  return !!tag && parseCactusTag(tag) !== null
}

const TokenResponse = z.object({ token: z.string().min(1) })
const TagsResponse = z.object({ tags: z.array(z.string()).nullable() })

async function pullToken(): Promise<string> {
  const res = await fetch(`${GHCR}/token?scope=repository:${CACTUS_IMAGE_REPO}:pull`, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`GHCR token ${res.status}`)
  return TokenResponse.parse(await res.json()).token
}

export function newestCactusBuild(): Promise<CactusBuild | null> {
  return remembered('newest', loadNewestCactusBuild)
}

async function loadNewestCactusBuild(): Promise<CactusBuild | null> {
  const token = await pullToken()
  const res = await fetch(`${GHCR}/v2/${CACTUS_IMAGE_REPO}/tags/list?n=1000`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`GHCR tags ${res.status}`)
  const tags = TagsResponse.parse(await res.json()).tags ?? []
  let newest: CactusBuild | null = null
  for (const t of tags) {
    const b = parseCactusTag(t)
    if (b && (!newest || compareBuilds(b, newest) > 0)) newest = b
  }
  return newest
}

// The manifest digest a tag points at. Asked for in the formats the build
// pushes, so the answer matches what Fly records for a machine pulled from it.
export function cactusTagDigest(tag: string): Promise<string | null> {
  return remembered(`digest:${tag}`, () => loadTagDigest(tag))
}

async function loadTagDigest(tag: string): Promise<string | null> {
  const token = await pullToken()
  const res = await fetch(`${GHCR}/v2/${CACTUS_IMAGE_REPO}/manifests/${encodeURIComponent(tag)}`, {
    method: 'HEAD',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.oci.image.index.v1+json',
      ].join(', '),
    },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.headers.get('docker-content-digest')
}

export type ImageBuildStatus = {
  // The Cactus build the machine runs, when it can be told: from its tag, or,
  // for a machine on `latest`, by matching what Fly pulled against the newest
  // build's digest.
  running: string | null
  newest: string | null
  // 'current' / 'available' when both ends are known; 'unknown' when the
  // machine is on a moving tag that does not match the newest build (an older
  // `latest`, most likely - pressing Update pins it to a real build number);
  // 'not-ours' for a hand-supplied image this lookup cannot number.
  update: 'current' | 'available' | 'unknown' | 'not-ours'
}

export async function imageBuildStatus(image: string | null, pulledDigest: string | null): Promise<ImageBuildStatus> {
  if (!image || !isCactusImage(image)) return { running: null, newest: null, update: 'not-ours' }
  const newest = await newestCactusBuild()
  const { tag } = splitImageRef(image)
  const pinned = tag ? parseCactusTag(tag) : null
  if (pinned) {
    if (!newest) return { running: pinned.tag, newest: null, update: 'unknown' }
    return { running: pinned.tag, newest: newest.tag, update: compareBuilds(newest, pinned) > 0 ? 'available' : 'current' }
  }
  if (!newest) return { running: null, newest: null, update: 'unknown' }
  const newestDigest = pulledDigest ? await cactusTagDigest(newest.tag) : null
  if (newestDigest && newestDigest === pulledDigest) return { running: newest.tag, newest: newest.tag, update: 'current' }
  return { running: null, newest: newest.tag, update: 'unknown' }
}

// The image an update should move the machine to: the newest build's exact
// tag in the same registry the machine already pulls from, so the running
// build can always be read back off the machine afterwards. Falls back to the
// old `latest` behaviour for a hand-supplied image or when GHCR cannot be
// reached - an update that still happens beats one refused over bookkeeping.
export async function updateTarget(image: string): Promise<string> {
  const { repo } = splitImageRef(image)
  if (isCactusImage(image)) {
    const newest = await newestCactusBuild().catch(() => null)
    if (newest) return `${repo}:${newest.tag}`
  }
  return `${repo}:latest`
}
