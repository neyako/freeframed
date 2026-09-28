import { describe, expect, it } from 'vitest'
import { mediaAspect } from '../aspect'

const withSize = (width: number | null, height: number | null) =>
  ({ latest_version: { files: [{ width, height }] } }) as any

describe('mediaAspect', () => {
  it('uses the media size, so vertical video stays vertical', () => {
    expect(mediaAspect(withSize(1080, 1920))).toBeCloseTo(0.5625)
    expect(mediaAspect(withSize(1920, 1080))).toBeCloseTo(16 / 9)
  })

  it('falls back to 16:9 without a size and clamps extremes', () => {
    expect(mediaAspect({ latest_version: null } as any)).toBeCloseTo(16 / 9)
    expect(mediaAspect(withSize(8000, 1000))).toBe(2.4)
  })
})
