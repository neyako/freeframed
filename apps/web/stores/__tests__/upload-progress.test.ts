import { describe, it, expect } from 'vitest'

import { getUploadDisplayProgress, type UploadFile } from '../upload-store'

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
})
