export interface ShareStreamInfo {
  readonly url: string
  readonly asset_type?: string
  readonly name?: string
  readonly version_id?: string | null
  readonly thumbnail_url?: string | null
  readonly duration_seconds?: number | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function parseShareStreamInfo(value: unknown): ShareStreamInfo {
  if (typeof value !== 'object' || value === null || !('url' in value) || typeof value.url !== 'string') {
    throw new Error('Invalid stream info')
  }

  return {
    url: value.url,
    asset_type: 'asset_type' in value && typeof value.asset_type === 'string' ? value.asset_type : undefined,
    name: 'name' in value && typeof value.name === 'string' ? value.name : undefined,
    version_id: 'version_id' in value && (typeof value.version_id === 'string' || value.version_id === null)
      ? value.version_id
      : undefined,
    thumbnail_url: 'thumbnail_url' in value && (typeof value.thumbnail_url === 'string' || value.thumbnail_url === null)
      ? value.thumbnail_url
      : undefined,
    duration_seconds: 'duration_seconds' in value && (typeof value.duration_seconds === 'number' || value.duration_seconds === null)
      ? value.duration_seconds
      : undefined,
  }
}

export async function fetchShareStreamInfo(
  token: string,
  assetId: string,
  opts: { readonly versionId?: string | null; readonly shareSession?: string | null } = {},
): Promise<ShareStreamInfo> {
  const params = new URLSearchParams()
  if (opts.versionId) params.set('version_id', opts.versionId)
  if (opts.shareSession) params.set('share_session', opts.shareSession)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_URL}/share/${token}/stream/${assetId}${qs}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to load stream info')
  return parseShareStreamInfo(await res.json())
}

export function resolveStreamUrl(url: string): string {
  if (!url.startsWith('/')) return url
  // Idempotent: with a path-relative API_URL (e.g. "/api"), a second resolve
  // would otherwise produce "/api/api/..."
  if (url.startsWith(`${API_URL}/`)) return url
  return `${API_URL}${url}`
}
