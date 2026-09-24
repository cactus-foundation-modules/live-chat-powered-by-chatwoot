import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareBuilds, imageBuildStatus, isCactusImage, parseCactusTag, splitImageRef } from './image-builds'

describe('parseCactusTag', () => {
  it('reads the Chatwoot version and build number', () => {
    expect(parseCactusTag('v4.16.2-cactus.4')).toEqual({ tag: 'v4.16.2-cactus.4', chatwoot: 'v4.16.2', build: 4 })
  })
  it('refuses anything else', () => {
    expect(parseCactusTag('latest')).toBeNull()
    expect(parseCactusTag('v4.16.2')).toBeNull()
    expect(parseCactusTag('v4.16.2-cactus.')).toBeNull()
  })
})

describe('compareBuilds', () => {
  const b = (t: string) => parseCactusTag(t)!
  it('a Cactus-only rebuild of the same Chatwoot release is newer', () => {
    expect(compareBuilds(b('v4.16.2-cactus.4'), b('v4.16.2-cactus.3'))).toBeGreaterThan(0)
  })
  it('the Chatwoot release outranks the build number', () => {
    expect(compareBuilds(b('v4.17.0-cactus.5'), b('v4.16.2-cactus.9'))).toBeGreaterThan(0)
    expect(compareBuilds(b('v4.16.10-cactus.1'), b('v4.16.9-cactus.1'))).toBeGreaterThan(0)
  })
})

describe('splitImageRef / isCactusImage', () => {
  it('splits tag, keeps a registry port, and treats a digest ref as tagless', () => {
    expect(splitImageRef('ghcr.io/cactus-foundation-modules/chatwoot:latest')).toEqual({ repo: 'ghcr.io/cactus-foundation-modules/chatwoot', tag: 'latest' })
    expect(splitImageRef('reg.example:5000/x/y')).toEqual({ repo: 'reg.example:5000/x/y', tag: null })
    expect(splitImageRef('ghcr.io/a/b@sha256:abc')).toEqual({ repo: 'ghcr.io/a/b', tag: null })
  })
  it('knows our images, including the Fly registry copy, and leaves others alone', () => {
    expect(isCactusImage('ghcr.io/cactus-foundation-modules/chatwoot:latest')).toBe(true)
    expect(isCactusImage('registry.fly.io/deskwell-chat:v4.16.2-cactus.3')).toBe(true)
    expect(isCactusImage('chatwoot/chatwoot:v4.16.2')).toBe(false)
  })
})

describe('imageBuildStatus', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubRegistry(tags: string[], digests: Record<string, string>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/token')) return new Response(JSON.stringify({ token: 't' }))
      if (url.includes('/tags/list')) return new Response(JSON.stringify({ tags }))
      const tag = decodeURIComponent(url.split('/manifests/')[1] ?? '')
      return new Response(null, { status: 200, headers: { 'docker-content-digest': digests[tag] ?? 'sha256:none' } })
    }))
  }

  it('a pinned older build of the same Chatwoot release has an update', async () => {
    stubRegistry(['latest', 'v4.16.2-cactus.3', 'v4.16.2-cactus.4'], {})
    expect(await imageBuildStatus('registry.fly.io/deskwell-chat:v4.16.2-cactus.3', null))
      .toEqual({ running: 'v4.16.2-cactus.3', newest: 'v4.16.2-cactus.4', update: 'available' })
  })

  it('a machine on latest is matched to the newest build by what Fly pulled', async () => {
    stubRegistry(['latest', 'v4.16.2-cactus.3', 'v4.16.2-cactus.4'], { 'v4.16.2-cactus.4': 'sha256:new' })
    const image = 'ghcr.io/cactus-foundation-modules/chatwoot:latest'
    expect(await imageBuildStatus(image, 'sha256:new')).toEqual({ running: 'v4.16.2-cactus.4', newest: 'v4.16.2-cactus.4', update: 'current' })
    expect(await imageBuildStatus(image, 'sha256:old')).toEqual({ running: null, newest: 'v4.16.2-cactus.4', update: 'unknown' })
  })

  it('a hand-supplied image is not ours to judge', async () => {
    expect(await imageBuildStatus('chatwoot/chatwoot:v4.16.2', null)).toEqual({ running: null, newest: null, update: 'not-ours' })
  })
})
