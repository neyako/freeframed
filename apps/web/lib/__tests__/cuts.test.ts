import { describe, expect, it } from 'vitest'
import { afterCutSeconds, cutAt, mergedCuts, toEditTime, toSourceTime } from '../cuts'

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

describe('edit timeline', () => {
  const cuts = [{ start: 10, end: 20 }, { start: 30, end: 35 }]

  it('maps source time onto the edit and back, skipping the cuts', () => {
    expect([5, 15, 20, 25, 32, 40].map((t) => toEditTime(t, cuts))).toEqual([5, 10, 10, 15, 20, 25])
    expect([5, 10, 15, 20, 25].map((t) => toSourceTime(t, cuts))).toEqual([5, 20, 25, 35, 40])
  })

  it('stepping back past the start lands after an opening cut, not in it', () => {
    expect(toSourceTime(-3, [{ start: 0, end: 10 }])).toBe(10)
  })

  it('jumps playback only from inside a cut', () => {
    expect(cutAt(12, cuts)).toEqual({ start: 10, end: 20 })
    expect(cutAt(20, cuts)).toBeUndefined()
    expect(cutAt(9.9, cuts)).toBeUndefined()
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
