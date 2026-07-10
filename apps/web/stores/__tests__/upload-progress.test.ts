import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssetResponse, AssetVersionStatus } from '@/types'
import {
  getUploadDisplayProgress,
  type UploadFile,
  type UploadStatus,
  useUploadStore,
} from '../upload-store'

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.apiGet,
    post: vi.fn(),
  },
}))

const overall = (p: number, n: number, fraction: number) =>
  Math.round(((p - 1 + fraction) / n) * 95)

const baseUpload: UploadFile = {
  id: 'upload-1',
  fileName: 'hero.mov',
  fileSize: 100,
  fileType: 'video/quicktime',
  projectId: 'project-1',
  assetName: 'hero.mov',
  progress: 0,
  processingProgress: 0,
  status: 'pending',
  createdAt: 1783382400000,
}

function upload(overrides: Partial<UploadFile>): UploadFile {
  return { ...baseUpload, ...overrides }
}

function asset(processingStatus: AssetVersionStatus): AssetResponse {
  return {
    id: 'asset-1',
    project_id: 'project-1',
    name: 'hero.mov',
    description: null,
    asset_type: 'video',
    status: 'in_review',
    rating: null,
    assignee_id: null,
    folder_id: null,
    due_date: null,
    keywords: [],
    created_by: 'user-1',
    created_at: '2026-07-11T00:00:00Z',
    updated_at: '2026-07-11T00:00:00Z',
    deleted_at: null,
    thumbnail_url: null,
    latest_version: {
      id: 'version-1',
      asset_id: 'asset-1',
      version_number: 1,
      processing_status: processingStatus,
      created_by: 'user-1',
      created_at: '2026-07-11T00:00:00Z',
      deleted_at: null,
      files: [],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUploadStore.setState({
    files: [],
    panelOpen: false,
    historyLoaded: false,
    historyHasMore: true,
    historyLoading: false,
    historySkip: 0,
  })
})

describe('multipart upload progress', () => {
  it('is 0 at the very start', () => {
    expect(overall(1, 5, 0)).toBe(0)
  })
  it('reaches 95 (not 100) when the last part completes', () => {
    expect(overall(5, 5, 1)).toBe(95)
  })
  it('is monotonic across a single-part upload', () => {
    const seq = [0, 0.25, 0.5, 0.75, 1].map((f) => overall(1, 1, f))
    expect(seq).toEqual([0, 24, 48, 71, 95])
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1])
  })

  it('uses upload progress before processing starts', () => {
    expect(getUploadDisplayProgress(upload({
      status: 'uploading',
      progress: 72,
      processingProgress: 11,
    }))).toBe(72)
  })

  it('uses processing progress during processing', () => {
    expect(getUploadDisplayProgress(upload({
      status: 'processing',
      progress: 100,
      processingProgress: 37,
    }))).toBe(37)
  })

  it.each([
    ['queued', 'processing'],
    ['uploading', 'uploading'],
    ['processing', 'processing'],
    ['ready', 'complete'],
    ['failed', 'failed'],
  ] satisfies readonly (readonly [AssetVersionStatus, UploadStatus])[])(
    'maps backend %s history rows to %s',
    async (processingStatus, expectedStatus) => {
      mocks.apiGet.mockResolvedValue([asset(processingStatus)])

      await useUploadStore.getState().fetchHistory()

      expect(useUploadStore.getState().files[0]?.status).toBe(expectedStatus)
    },
  )

  it('keeps polling rows active when the backend reports queued', async () => {
    useUploadStore.setState({
      files: [upload({
        status: 'processing',
        progress: 100,
        processingProgress: 37,
        assetId: 'asset-1',
      })],
    })
    mocks.apiGet.mockResolvedValue(asset('queued'))

    await useUploadStore.getState().refreshProcessingItems()

    expect(useUploadStore.getState().files[0]).toMatchObject({
      status: 'processing',
      processingProgress: 37,
    })
  })
})
