import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchShareStreamInfo, resolveStreamUrl } from '../share-stream'

describe('fetchShareStreamInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the share stream endpoint with version and session params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: '/stream/hls/master.m3u8?token=x' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchShareStreamInfo('tok', 'asset-1', {
      versionId: 'v1',
      shareSession: 's1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/share/tok/stream/asset-1?version_id=v1&share_session=s1',
    )
  })

  it('omits optional query params when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: '/stream/hls/master.m3u8?token=x' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchShareStreamInfo('tok', 'asset-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/share/tok/stream/asset-1',
    )
  })

  it('rejects when stream info cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    await expect(fetchShareStreamInfo('tok', 'asset-1')).rejects.toThrow(
      new Error('Failed to load stream info'),
    )
  })
})

describe('resolveStreamUrl', () => {
  it('prefixes relative stream URLs with the API origin', () => {
    expect(resolveStreamUrl('/stream/hls/master.m3u8?token=x')).toBe(
      'http://localhost:8000/stream/hls/master.m3u8?token=x',
    )
  })

  it('leaves absolute stream URLs unchanged', () => {
    expect(resolveStreamUrl('https://cdn.example.test/x.mp4')).toBe(
      'https://cdn.example.test/x.mp4',
    )
  })
})
