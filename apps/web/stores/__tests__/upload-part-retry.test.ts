import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    detail: string
    constructor(status: number, detail: string) {
      super(detail)
      this.status = status
      this.detail = detail
    }
  }
  return { api: { post: vi.fn(), get: vi.fn() }, ApiError }
})

import { api } from '@/lib/api'
import { uploadAllParts } from '../upload-store'

// What each PUT answers, in order: an HTTP status, or 'network' for a dropped connection.
let puts: Array<number | 'network'>
let sent: number

class FakeXHR {
  status = 0
  statusText = ''
  upload: { onprogress: null | ((e: unknown) => void) } = { onprogress: null }
  onload: null | (() => void) = null
  onerror: null | (() => void) = null
  onabort: null | (() => void) = null
  open() {}
  setRequestHeader() {}
  getResponseHeader() {
    return '"etag"'
  }
  abort() {
    this.onabort?.()
  }
  send() {
    sent += 1
    const next = puts.shift() ?? 200
    queueMicrotask(() => {
      if (next === 'network') return this.onerror?.()
      this.status = next
      this.statusText = String(next)
      this.onload?.()
    })
  }
}

// uploadAllParts only reads size and slices; two 10 MB parts.
const twoPartFile = { size: 12 * 1024 * 1024, slice: () => new Blob(['x']) } as unknown as File

function upload(controller = new AbortController()) {
  return uploadAllParts(twoPartFile, 'raw/key', 'upload-1', controller, () => {})
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.mocked(api.post).mockResolvedValue({ presigned_url: 'https://s3.test/part' })
  sent = 0
  puts = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('uploadAllParts retries', () => {
  it('retries a transient 503 and a dropped connection, then finishes', async () => {
    puts = [503, 'network'] // part 1 fails twice, then every PUT succeeds
    const done = upload()
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(done).resolves.toEqual([
      { PartNumber: 1, ETag: '"etag"' },
      { PartNumber: 2, ETag: '"etag"' },
    ])
    expect(sent).toBe(4)
    // a fresh presigned URL per attempt: the old one may have expired
    expect(api.post).toHaveBeenCalledTimes(4)
  })

  it('does not retry a rejected request', async () => {
    puts = [403]
    await expect(upload()).rejects.toThrow('Part failed: 403')
    expect(sent).toBe(1)
  })

  it('gives up after 8 attempts on a part that keeps failing', async () => {
    puts = Array(20).fill(500)
    const done = upload()
    const settled = expect(done).rejects.toThrow('Part failed: 500')
    await vi.advanceTimersByTimeAsync(600_000)
    await settled
    expect(sent).toBe(8)
  })

  it('never retries a cancel', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(upload(controller)).rejects.toMatchObject({ name: 'AbortError' })
    expect(sent).toBe(0)
  })
})
