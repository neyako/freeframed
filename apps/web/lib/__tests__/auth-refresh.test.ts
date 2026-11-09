import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshAccessToken } from '../auth'

// A failed refresh used to sign the user out whatever the reason, so a dropped
// connection or a proxy restart ended the session. Only a refusal should.
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/projects', pathname: '/projects' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const logoutCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/logout'))

describe('refreshAccessToken', () => {
  it('keeps the session when the request never gets an answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    expect(await refreshAccessToken()).toBeNull()
    expect(logoutCalls()).toHaveLength(0)
    expect(window.location.href).toBe('http://localhost/projects')
  })

  it.each([500, 502, 503, 429])('keeps the session on a %i from the server', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status })

    expect(await refreshAccessToken()).toBeNull()
    expect(logoutCalls()).toHaveLength(0)
  })

  it.each([401, 403])('signs out when the server refuses the refresh token (%i)', async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status })

    expect(await refreshAccessToken()).toBeNull()
    expect(logoutCalls()).toHaveLength(1)
  })

  it('returns the new access token on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'new-access' }) })

    expect(await refreshAccessToken()).toBe('new-access')
    expect(logoutCalls()).toHaveLength(0)
  })
})
