import { describe, expect, it } from 'vitest'
import type { AssetResponse } from '@/types'
import { sortAssets } from '../sort-assets'

type Row = Pick<AssetResponse, 'updated_at' | 'name' | 'status' | 'asset_type'>

const asset = (name: string, over: Partial<Row> = {}): Row => ({
  name,
  updated_at: '2026-01-01T00:00:00Z',
  status: 'draft',
  asset_type: 'video',
  ...over,
})

const names = (list: Row[]) => list.map((a) => a.name)

describe('sortAssets', () => {
  it('sorts by name in both directions', () => {
    const list = [asset('b'), asset('c'), asset('a')]
    expect(names(sortAssets(list, 'name', 'asc'))).toEqual(['a', 'b', 'c'])
    expect(names(sortAssets(list, 'name', 'desc'))).toEqual(['c', 'b', 'a'])
  })

  it('sorts by last update, newest first when descending', () => {
    const list = [
      asset('old', { updated_at: '2026-01-01T00:00:00Z' }),
      asset('new', { updated_at: '2026-03-01T00:00:00Z' }),
      asset('mid', { updated_at: '2026-02-01T00:00:00Z' }),
    ]
    expect(names(sortAssets(list, 'date', 'desc'))).toEqual(['new', 'mid', 'old'])
  })

  it('sorts by review status in pipeline order', () => {
    const list = [
      asset('done', { status: 'approved' }),
      asset('waiting', { status: 'in_review' }),
      asset('wip', { status: 'draft' }),
    ]
    expect(names(sortAssets(list, 'status', 'asc'))).toEqual(['waiting', 'wip', 'done'])
  })

  it('keeps the API order for custom, and never mutates its input', () => {
    const list = [asset('b'), asset('a')]
    expect(names(sortAssets(list, 'custom', 'asc'))).toEqual(['b', 'a'])
    sortAssets(list, 'name', 'asc')
    expect(names(list)).toEqual(['b', 'a'])
  })
})
