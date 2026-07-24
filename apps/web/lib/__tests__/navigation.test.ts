import { describe, it, expect } from 'vitest'
import { canGoBackInApp } from '../navigation'

const ORIGIN = 'http://localhost:3000'

describe('canGoBackInApp', () => {
  it('goes back after an in-app client-side navigation', () => {
    // Fresh load of the dashboard (no referrer), then a push to the asset.
    expect(canGoBackInApp({ length: 2 }, '', ORIGIN)).toBe(true)
  })

  it('goes back when the previous page was same-origin', () => {
    // e.g. the notification drawer, which uses a full window.location.href nav.
    expect(canGoBackInApp({ length: 3 }, `${ORIGIN}/projects/abc`, ORIGIN)).toBe(true)
  })

  it('does not go back from a fresh tab or share-link redirect', () => {
    // location.replace / router.replace leave no entry behind.
    expect(canGoBackInApp({ length: 1 }, '', ORIGIN)).toBe(false)
  })

  it('does not send the user off-site when the URL was pasted over another page', () => {
    expect(canGoBackInApp({ length: 2 }, 'https://mail.google.com/', ORIGIN)).toBe(false)
  })

  it('is not fooled by an origin that merely starts with ours', () => {
    expect(canGoBackInApp({ length: 2 }, 'http://localhost:30001/evil', ORIGIN)).toBe(false)
  })
})
