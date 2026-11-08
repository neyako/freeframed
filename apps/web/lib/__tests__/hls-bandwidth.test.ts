import { beforeEach, describe, expect, it } from 'vitest'
import { hlsStartConfig, savedBandwidth, saveBandwidth } from '../hls-bandwidth'

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => window.localStorage.clear())

describe('saved bandwidth', () => {
  it('round-trips a measurement', () => {
    saveBandwidth(8_000_000, NOW)
    expect(savedBandwidth(NOW + 1000)).toBe(8_000_000)
  })

  it('holds a very fast measurement to 20 Mbps', () => {
    saveBandwidth(900_000_000, NOW)
    expect(savedBandwidth(NOW)).toBe(20_000_000)
  })

  it('ignores a measurement older than a day, or one stamped in the future', () => {
    saveBandwidth(8_000_000, NOW)
    expect(savedBandwidth(NOW + DAY + 1)).toBeUndefined()
    saveBandwidth(8_000_000, NOW + 10 * 60 * 1000)
    expect(savedBandwidth(NOW)).toBeUndefined()
  })

  it('refuses to save nonsense and survives corrupt storage', () => {
    saveBandwidth(0, NOW)
    saveBandwidth(Number.NaN, NOW)
    expect(savedBandwidth(NOW)).toBeUndefined()
    window.localStorage.setItem('ff-hls-bandwidth', '{not json')
    expect(savedBandwidth(NOW)).toBeUndefined()
  })

  it('starts hls.js untouched with nothing saved, and from the estimate with something', () => {
    expect(hlsStartConfig()).toEqual({})
    saveBandwidth(12_000_000)
    expect(hlsStartConfig()).toEqual({ abrEwmaDefaultEstimate: 12_000_000 })
  })
})
