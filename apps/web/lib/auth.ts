const ACCESS_TOKEN_KEY = 'ff_access_token'
const REFRESH_TOKEN_KEY = 'ff_refresh_token'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function clearLegacyTokens(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  document.cookie = `${ACCESS_TOKEN_KEY}=; path=/; max-age=0`
  document.cookie = `${REFRESH_TOKEN_KEY}=; path=/; max-age=0`
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  clearLegacyTokens()
  return null
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  clearLegacyTokens()
  return null
}

export function setTokens(access: string, refresh: string): void {
  if (typeof window === 'undefined') return
  void access
  void refresh
  clearLegacyTokens()
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return
  clearLegacyTokens()
  fetch(`${API_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
  }).finally(() => {
    window.location.href = '/login'
  })
}

// Deduplicate concurrent refresh calls — when access token expires, multiple
// API calls may simultaneously get 401 and try to refresh. Only one should run.
let _refreshPromise: Promise<string | null> | null = null

export async function refreshAccessToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise

  _refreshPromise = _doRefresh()
  try {
    return await _refreshPromise
  } finally {
    _refreshPromise = null
  }
}

async function _doRefresh(): Promise<string | null> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })

    if (!response.ok) {
      clearTokens()
      return null
    }

    const data = await response.json()
    const newAccessToken: string = data.access_token

    clearLegacyTokens()
    return newAccessToken
  } catch {
    clearTokens()
    return null
  }
}
