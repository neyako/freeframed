import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ReviewPage from '../page'

const mocks = vi.hoisted(() => ({
  permission: 'view' as 'view' | 'comment' | 'approve',
  projectState: 'loaded' as 'loaded' | 'member' | 'loading' | 'denied' | 'denied-stale',
  reviewError: null as string | null,
  swrKeys: [] as string[],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) mocks.swrKeys.push(key)
    if (key === '/projects/project-1') {
      return {
        data: mocks.projectState === 'loaded' || mocks.projectState === 'denied-stale'
          ? {
              id: 'project-1', name: 'Scoped project', role: null,
              folder_access: {
                kind: 'folder_direct', accessible_root_ids: ['folder-a'],
                grants: [{ folder_id: 'folder-a', permission: mocks.permission }],
              },
            }
          : mocks.projectState === 'member'
            ? { id: 'project-1', name: 'Member project', role: 'reviewer', folder_access: null }
            : undefined,
        error: mocks.projectState === 'denied' || mocks.projectState === 'denied-stale'
          ? { status: 403, detail: 'Access denied' }
          : undefined,
        isLoading: mocks.projectState === 'loading',
      }
    }
    if (key === '/projects/project-1/folder-tree') {
      return {
        data: [{
          id: 'folder-a', name: 'Shared A', parent_id: null, item_count: 1,
          children: [{ id: 'folder-a1', name: 'Child A1', parent_id: 'folder-a', item_count: 1, children: [] }],
        }],
      }
    }
    if (key === '/projects/project-1/assets') return { data: [] }
    return { data: [] }
  },
}))

const asset = {
  id: 'asset-1', project_id: 'project-1', folder_id: 'folder-a1', name: 'Scoped clip',
  description: null, asset_type: 'video', status: 'in_review', rating: null,
  assignee_id: null, due_date: null, keywords: [], created_by: 'owner-1',
  created_at: '2026-07-12T00:00:00Z', updated_at: '2026-07-12T00:00:00Z',
}

vi.mock('@/components/review/review-provider', () => ({
  ReviewProvider: ({ children }: { readonly children: React.ReactNode }) => children,
  useReview: () => ({
    asset: mocks.reviewError ? null : asset,
    versions: [{ id: 'version-1', processing_status: 'ready' }],
    isLoading: false,
    error: mocks.reviewError,
    refetchComments: vi.fn(),
    refetchVersions: vi.fn(),
  }),
}))
vi.mock('@/components/review/video-player', () => ({ VideoPlayer: () => <div>Video player</div> }))
vi.mock('@/components/review/audio-player', () => ({ AudioPlayer: () => null }))
vi.mock('@/components/review/image-viewer', () => ({ ImageViewer: () => null }))
vi.mock('@/components/review/annotation-canvas', () => ({ AnnotationCanvas: () => null }))
vi.mock('@/components/review/annotation-overlay', () => ({ AnnotationOverlay: () => null }))
vi.mock('@/components/review/comment-panel', () => ({ CommentPanel: () => <div>Comment panel</div> }))
vi.mock('@/components/review/comment-input', () => ({ CommentInput: () => <div>Comment input</div> }))
vi.mock('@/components/review/approval-bar', () => ({
  ApprovalBar: () => <div><button>Reject</button><button>Approve</button></div>,
}))
vi.mock('@/components/review/version-switcher', () => ({ VersionSwitcher: () => <div>Versions</div> }))
vi.mock('@/components/review/share-dialog', () => ({ ShareDialog: () => <button>Share asset</button> }))
vi.mock('@/stores/review-store', () => ({
  useReviewStore: () => ({
    currentVersion: { id: 'version-1', processing_status: 'ready' }, isDrawingMode: false,
    focusedCommentId: null, seekTo: vi.fn(), setFocusedCommentId: vi.fn(), setActiveAnnotation: vi.fn(),
  }),
}))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'recipient-1' } }) }))
vi.mock('@/stores/upload-store', () => ({ useUploadStore: () => vi.fn() }))
vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: (selector: (state: { readonly setLabel: () => void; readonly setExtraCrumbs: () => void }) => unknown) =>
    selector({ setLabel: vi.fn(), setExtraCrumbs: vi.fn() }),
}))
vi.mock('@/hooks/use-comments', () => ({
  useComments: () => ({
    comments: [], createComment: vi.fn(), resolveComment: vi.fn(), deleteComment: vi.fn(),
    addReaction: vi.fn(), removeReaction: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

describe('ReviewPage folder-direct access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.projectState = 'loaded'
    mocks.reviewError = null
    mocks.swrKeys.length = 0
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() }),
    })
  })

  it.each([
    ['view', false],
    ['comment', true],
    ['approve', true],
  ] as const)('maps %s grant without member fetch or privileged controls', (permission, canComment) => {
    mocks.permission = permission
    render(<ReviewPage params={{ id: 'project-1', assetId: 'asset-1' }} />)

    expect(mocks.swrKeys).not.toContain('/projects/project-1/members')
    expect(mocks.swrKeys).toContain('/projects/project-1/assets')
    expect(screen.queryByText('New version')).not.toBeInTheDocument()
    expect(screen.queryByText('Download')).not.toBeInTheDocument()
    expect(screen.queryByText('Share asset')).not.toBeInTheDocument()
    expect(screen.queryByText('Comment input') !== null).toBe(canComment)
    expect(screen.queryByRole('button', { name: 'Approve' }) !== null).toBe(permission === 'approve')
    expect(screen.queryByRole('button', { name: 'Reject' }) !== null).toBe(permission === 'approve')
  })

  it.each(['loading', 'denied'] as const)(
    'does not expose privileged controls while project access is %s',
    (projectState) => {
      mocks.projectState = projectState
      render(<ReviewPage params={{ id: 'project-1', assetId: 'asset-1' }} />)

      expect(screen.queryByText('New version')).not.toBeInTheDocument()
      expect(screen.queryByText('Download')).not.toBeInTheDocument()
      expect(screen.queryByText('Share asset')).not.toBeInTheDocument()
      expect(screen.queryByText('Video player')).not.toBeInTheDocument()
    },
  )

  it('renders access denied instead of loading forever when asset access fails', () => {
    mocks.reviewError = 'Access denied'
    render(<ReviewPage params={{ id: 'project-1', assetId: 'asset-1' }} />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading review/i)).not.toBeInTheDocument()
  })

  it('does not fetch navigation collections when revoked project data is retained', () => {
    mocks.projectState = 'denied-stale'
    render(<ReviewPage params={{ id: 'project-1', assetId: 'asset-1' }} />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(mocks.swrKeys).not.toContain('/projects/project-1/folder-tree')
    expect(mocks.swrKeys).not.toContain('/projects/project-1/assets')
  })

  it('shows approval controls to an eligible project reviewer', () => {
    mocks.projectState = 'member'
    render(<ReviewPage params={{ id: 'project-1', assetId: 'asset-1' }} />)

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })
})
