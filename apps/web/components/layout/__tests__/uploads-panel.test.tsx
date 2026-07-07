import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UploadsPanel } from '../uploads-panel'

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  disconnect = vi.fn()
  observe = vi.fn()
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  unobserve = vi.fn()
}

interface MockUploadFile {
  readonly id: string
  readonly fileName: string
  readonly fileSize: number
  readonly fileType: string
  readonly projectId: string
  readonly projectName?: string
  readonly assetName: string
  readonly progress: number
  readonly processingProgress: number
  readonly status: 'pending' | 'uploading' | 'processing' | 'complete' | 'failed' | 'cancelled'
  readonly source?: 'quick-share'
  readonly createdAt: number
}

interface MockStoreState {
  files: MockUploadFile[]
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  clearCompleted: () => void
  fetchHistory: () => Promise<void>
  fetchMoreHistory: () => Promise<void>
  historyHasMore: boolean
  historyLoading: boolean
  cancelUpload: (fileId: string) => void
  removeFile: (fileId: string) => void
}

const mocks = vi.hoisted(() => {
  const storeState: MockStoreState = {
    files: [],
    panelOpen: true,
    setPanelOpen: vi.fn<(open: boolean) => void>(),
    clearCompleted: vi.fn<() => void>(),
    fetchHistory: vi.fn<() => Promise<void>>(async () => {}),
    fetchMoreHistory: vi.fn<() => Promise<void>>(async () => {}),
    historyHasMore: false,
    historyLoading: false,
    cancelUpload: vi.fn<(fileId: string) => void>(),
    removeFile: vi.fn<(fileId: string) => void>(),
  }

  return {
    pathname: '/',
    storeState,
  }
})

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock('@/stores/upload-store', () => ({
  getUploadDisplayProgress: (upload: MockUploadFile) =>
    upload.status === 'processing' ? upload.processingProgress : upload.progress,
  isQuickShareUpload: (upload: MockUploadFile) => upload.source === 'quick-share',
  useUploadStore: () => mocks.storeState,
}))

function upload(overrides: Partial<MockUploadFile>): MockUploadFile {
  return {
    id: 'upload-1',
    fileName: 'hero.mov',
    fileSize: 100,
    fileType: 'video/quicktime',
    projectId: 'project-1',
    assetName: 'hero.mov',
    progress: 42,
    processingProgress: 0,
    status: 'uploading',
    createdAt: 1783382400000,
    ...overrides,
  }
}

describe('UploadsPanel quick-share suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathname = '/'
    mocks.storeState.files = []
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: MockIntersectionObserver,
    })
  })

  it('hides quick-share-only uploads on the dashboard home', () => {
    mocks.storeState.files = [upload({ source: 'quick-share' })]

    render(<UploadsPanel />)

    expect(screen.queryByText('Uploads')).not.toBeInTheDocument()
  })

  it('keeps other active uploads visible on the dashboard home', () => {
    mocks.storeState.files = [
      upload({ source: 'quick-share' }),
      upload({ id: 'upload-2', fileName: 'other.mov', assetName: 'other.mov' }),
    ]

    render(<UploadsPanel />)

    expect(screen.getByText('Uploads')).toBeInTheDocument()
    expect(screen.getByText('other.mov')).toBeInTheDocument()
    expect(screen.queryByText('hero.mov')).not.toBeInTheDocument()
  })

  it('shows quick-share uploads after leaving the dashboard home', () => {
    mocks.pathname = '/projects/project-1/assets/asset-1'
    mocks.storeState.files = [upload({ source: 'quick-share' })]

    render(<UploadsPanel />)

    expect(screen.getByText('Uploads')).toBeInTheDocument()
    expect(screen.getByText('hero.mov')).toBeInTheDocument()
  })
})
