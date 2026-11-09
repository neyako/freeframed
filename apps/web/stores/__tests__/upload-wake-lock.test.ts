import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseWakeLock, retainWakeLock } from '../upload-store'

function sentinel() {
  return { release: vi.fn().mockResolvedValue(undefined), addEventListener: vi.fn() }
}

let request: ReturnType<typeof vi.fn>

beforeEach(() => {
  request = vi.fn()
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
})

afterEach(() => {
  // drain holders left by a test, then drop the stub
  for (let i = 0; i < 5; i++) releaseWakeLock()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('upload wake lock', () => {
  it('asks once for several uploads started together, and releases after the last', async () => {
    const lock = sentinel()
    request.mockResolvedValue(lock)

    retainWakeLock()
    retainWakeLock()
    retainWakeLock()
    await flush()
    expect(request).toHaveBeenCalledTimes(1)

    releaseWakeLock()
    releaseWakeLock()
    expect(lock.release).not.toHaveBeenCalled()
    releaseWakeLock()
    expect(lock.release).toHaveBeenCalledTimes(1)
  })

  it('does not hold a lock that arrives after every upload finished', async () => {
    const lock = sentinel()
    request.mockResolvedValue(lock)

    retainWakeLock()
    releaseWakeLock() // before the request resolves
    await flush()
    expect(lock.release).toHaveBeenCalledTimes(1)
  })

  it('carries on when the browser refuses the lock', async () => {
    request.mockRejectedValue(new DOMException('low battery', 'NotAllowedError'))
    expect(() => retainWakeLock()).not.toThrow()
    await flush()
    releaseWakeLock()
  })
})
