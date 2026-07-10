import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssetVersionStatus } from '@/types'
import ReviewPage from '../assets/[assetId]/page'

const mocks = vi.hoisted(() => ({
  status: 'queued',
  refetchComments: vi.fn<() => Promise<void>>(async () => {}),
  refetchVersions: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('swr', () => ({
  default: () => ({ data: [] }),
}))

vi.mock('@/components/review/review-provider', () => ({
  ReviewProvider: ({ children }: { children: ReactNode }) => children,
  useReview: () => ({
    asset: {
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
      latest_version: null,
    },
    versions: [],
    isLoading: false,
    refetchComments: mocks.refetchComments,
    refetchVersions: mocks.refetchVersions,
  }),
}))

vi.mock('@/stores/review-store', () => ({
  useReviewStore: () => ({
    currentVersion: {
      id: 'version-1',
      asset_id: 'asset-1',
      version_number: 1,
      processing_status: mocks.status,
      created_by: 'user-1',
      created_at: '2026-07-11T00:00:00Z',
      deleted_at: null,
      files: [],
    },
    isDrawingMode: false,
    focusedCommentId: null,
    seekTo: vi.fn(),
    setFocusedCommentId: vi.fn(),
    setActiveAnnotation: vi.fn(),
  }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ user: null }),
}))

vi.mock('@/stores/upload-store', () => ({
  useUploadStore: () => vi.fn(),
}))

vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: () => vi.fn(),
}))

vi.mock('@/hooks/use-comments', () => ({
  useComments: () => ({
    comments: [],
    createComment: vi.fn(),
    resolveComment: vi.fn(),
    deleteComment: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/review/video-player', () => ({
  VideoPlayer: () => <div>Video viewer</div>,
}))
vi.mock('@/components/review/audio-player', () => ({ AudioPlayer: () => null }))
vi.mock('@/components/review/image-viewer', () => ({ ImageViewer: () => null }))
vi.mock('@/components/review/annotation-canvas', () => ({ AnnotationCanvas: () => null }))
vi.mock('@/components/review/annotation-overlay', () => ({ AnnotationOverlay: () => null }))
vi.mock('@/components/review/comment-panel', () => ({ CommentPanel: () => null }))
vi.mock('@/components/review/comment-input', () => ({ CommentInput: () => null }))
vi.mock('@/components/review/version-switcher', () => ({ VersionSwitcher: () => null }))
vi.mock('@/components/review/share-dialog', () => ({ ShareDialog: () => null }))

describe('authenticated asset review processing states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      } satisfies MediaQueryList)),
    })
  })

  it.each([
    ['queued', 'Processing asset'],
    ['processing', 'Processing asset'],
    ['uploading', 'Processing asset'],
    ['failed', 'Processing failed'],
    ['ready', 'Video viewer'],
  ] satisfies readonly (readonly [AssetVersionStatus, string])[])(
    'renders %s through the expected existing viewer state',
    (status, expectedText) => {
      mocks.status = status

      render(<ReviewPage params={{ id: 'project-1', assetId: 'asset-1' }} />)

      expect(screen.getByText(expectedText)).toBeInTheDocument()
      if (status === 'queued') {
        expect(screen.queryByText('Version not ready')).not.toBeInTheDocument()
      }
    },
  )
})
