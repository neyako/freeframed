import { describe, expect, it } from 'vitest'
import { afterCutSeconds, mergedCuts } from '../cuts'

const cut = (start: number, end: number) => ({ is_cut: true, timecode_start: start, timecode_end: end })

describe('after-cut runtime', () => {
  it('subtracts every cut from the runtime', () => {
    const cuts = mergedCuts([cut(12, 19), cut(65, 81), cut(160, 171)], 204.5)
    expect(afterCutSeconds(204.5, cuts)).toBeCloseTo(170.5)
  })

  it('counts overlapping cuts once and ignores plain comments', () => {
    const comments = [cut(10, 20), cut(15, 30), { is_cut: false, timecode_start: 40, timecode_end: 50 }]
    expect(mergedCuts(comments, 60)).toEqual([{ start: 10, end: 30 }])
  })

  it('clamps cuts that run past the end', () => {
    expect(afterCutSeconds(60, mergedCuts([cut(50, 90)], 60))).toBe(50)
  })
})

describe('range labels', () => {
  it('shows tenths for short ranges so they never read as zero length', async () => {
    const { formatRange, formatSpan } = await import('../cuts')
    expect(formatRange(2.05, 2.78)).toBe('0:02.0 → 0:02.8')
    expect(formatSpan(0.73)).toBe('0.7s')
    expect(formatRange(106, 119)).toBe('1:46 → 1:59')
    expect(formatSpan(13)).toBe('0:13')
  })
})
