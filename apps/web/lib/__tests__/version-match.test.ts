import { describe, expect, it } from 'vitest'
import type { AssetResponse } from '@/types'
import { findVersionCandidate, normalizeAssetName } from '../version-match'

const heroCutAsset = {
  id: 'asset-hero-cut',
  project_id: 'project-1',
  name: 'Hero Cut',
  description: null,
  asset_type: 'video',
  status: 'draft',
  rating: null,
  assignee_id: null,
  folder_id: null,
  due_date: null,
  keywords: [],
  created_by: 'user-1',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  deleted_at: null,
  latest_version: null,
  thumbnail_url: null,
} satisfies AssetResponse

describe('normalizeAssetName', () => {
  it('strips trailing version markers', () => {
    expect(normalizeAssetName('Draft 1.mp4')).toBe('draft')
    expect(normalizeAssetName('draft v2.mov')).toBe('draft')
  })

  it('keeps non-version words', () => {
    expect(normalizeAssetName('Hero Cut.mp4')).toBe('hero cut')
  })
})

describe('findVersionCandidate', () => {
  it('returns matching asset for normalized upload name', () => {
    expect(findVersionCandidate('hero cut v2.mp4', [heroCutAsset])).toBe(heroCutAsset)
  })

  it('returns null when upload name does not match an asset', () => {
    expect(findVersionCandidate('totally new.mp4', [heroCutAsset])).toBeNull()
  })

  it('returns null for extension-only upload name', () => {
    expect(findVersionCandidate('.mp4', [heroCutAsset])).toBeNull()
  })
})
