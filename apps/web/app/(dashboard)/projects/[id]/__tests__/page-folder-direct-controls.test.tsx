import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectDetailPage from '../page'

const mocks = vi.hoisted(() => ({
  permission: 'view' as 'view' | 'comment' | 'approve',
  resolveComment: vi.fn(),
  deleteComment: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
}))

const asset = {
  id: 'asset-1', project_id: 'project-1', folder_id: 'folder-a', name: 'Scoped clip',
  description: null, asset_type: 'video', status: 'in_review', rating: null,
  assignee_id: null, due_date: null, keywords: [], created_by: 'owner-1',
  created_at: '2026-07-12T00:00:00Z', updated_at: '2026-07-12T00:00:00Z',
  deleted_at: null, thumbnail_url: null,
  latest_version: { id: 'version-1', version_number: 1, files: [] },
}

const comment = {
  id: 'comment-1', asset_id: 'asset-1', version_id: 'version-1', parent_id: null,
  author_id: 'recipient-1', guest_author_id: null, timecode_start: null, timecode_end: null,
  body: 'Scoped comment', resolved: false, visibility: 'public',
  created_at: '2026-07-12T00:00:00Z', updated_at: '2026-07-12T00:00:00Z', deleted_at: null,
  replies: [], annotation: null, reactions: [],
  author: { id: 'recipient-1', name: 'Recipient', avatar_url: null }, guest_author: null,
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'project-1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('folder=folder-a'),
}))
vi.mock('next/link', () => ({ default: ({ children }: { readonly children: React.ReactNode }) => children }))
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/projects/project-1') return { data: {
      id: 'project-1', name: 'Scoped project', role: null,
      folder_access: { kind: 'folder_direct', accessible_root_ids: ['folder-a'],
        grants: [{ folder_id: 'folder-a', permission: mocks.permission }] },
    }, isLoading: false }
    if (key?.includes('/assets?')) return { data: [asset], isLoading: false, mutate: vi.fn() }
    if (key?.includes('/folders?')) return { data: [], mutate: vi.fn() }
    return { data: [] }
  },
}))
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/upload-store', () => ({ useUploadStore: () => ({
  files: [], startUpload: vi.fn(), startVersionUpload: vi.fn(),
}) }))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'recipient-1' } }) }))
vi.mock('@/stores/view-store', () => ({ useViewStore: () => ({
  rightPanelOpen: true, leftPanelOpen: true, toggleLeftPanel: vi.fn(), layout: 'grid', cardSize: 'M',
  aspectRatio: 'landscape', thumbnailScale: 'fit', showCardInfo: true, titleLines: '1',
  flattenFolders: false, showFileSize: true, showUploader: true, sortKey: 'custom', sortDirection: 'asc',
}) }))
vi.mock('@/stores/review-store', () => ({
  useReviewStore: (selector: (state: {
    readonly focusedCommentId: null
    readonly seekTo: () => void
    readonly setFocusedCommentId: () => void
    readonly setActiveAnnotation: () => void
  }) => unknown) => selector({
    focusedCommentId: null,
    seekTo: vi.fn(),
    setFocusedCommentId: vi.fn(),
    setActiveAnnotation: vi.fn(),
  }),
}))
vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: (selector: (state: { readonly setLabel: () => void; readonly setExtraCrumbs: () => void }) => unknown) =>
    selector({ setLabel: vi.fn(), setExtraCrumbs: vi.fn() }),
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/use-comments', () => ({ useComments: () => ({
  comments: [comment], resolveComment: mocks.resolveComment, deleteComment: mocks.deleteComment,
  addReaction: mocks.addReaction, removeReaction: mocks.removeReaction,
}) }))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    tree: [{ id: 'folder-a', name: 'Shared A', parent_id: null, item_count: 1, children: [] }],
    isLoading: false, mutateTree: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(),
    moveFolder: vi.fn(), deleteFolder: vi.fn(), moveAsset: vi.fn(), bulkMove: vi.fn(),
    restoreAsset: vi.fn(), restoreFolder: vi.fn(),
  }),
  useTrash: () => ({ trash: { folders: [], assets: [] }, mutateTrash: vi.fn() }),
}))
vi.mock('@/components/projects/asset-grid', () => ({
  AssetGrid: ({ onAssetSelect }: {
    readonly onAssetSelect?: (value: typeof asset, event: React.MouseEvent) => void
  }) => (
    <button type="button" onClick={(event) => onAssetSelect?.(asset, event)}>Select scoped asset</button>
  ),
}))
vi.mock('@/components/upload/upload-zone', () => ({ UploadZone: () => null }))
vi.mock('@/components/projects/name-dialog', () => ({ NameDialog: () => null }))
vi.mock('@/components/review/share-dialog', () => ({ BulkSharePanel: () => null, SharePanel: () => null }))
vi.mock('@/components/projects/project-members-dialog', () => ({ ProjectMembersDialog: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }))

function openSelectedPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Select scoped asset' }))
}

describe('ProjectDetailPage folder-direct controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission = 'view'
  })

  it('renders the real scoped tree without comment mutation affordances for view grants', () => {
    render(<ProjectDetailPage />)
    expect(screen.getAllByText('Shared A')).not.toHaveLength(0)

    openSelectedPanel()
    expect(screen.getByText('Scoped comment')).toBeInTheDocument()
    expect(screen.queryByText('Reply')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Add reaction')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Resolve')).not.toBeInTheDocument()
  })

  it('hides selected-panel raw download for folder-direct access', () => {
    render(<ProjectDetailPage />)
    openSelectedPanel()

    fireEvent.click(screen.getByText('Fields'))
    expect(screen.queryByText('Download')).not.toBeInTheDocument()
  })

  it.each(['comment', 'approve'] as const)('renders comment mutation affordances for %s grants', (permission) => {
    mocks.permission = permission
    const { container } = render(<ProjectDetailPage />)
    openSelectedPanel()

    expect(screen.getByText('Reply')).toBeInTheDocument()
    expect(screen.getByTitle('Add reaction')).toBeInTheDocument()
    expect(screen.getByTitle('Resolve')).toBeInTheDocument()
    const menuIcon = container.querySelector('svg.lucide-ellipsis')
    expect(menuIcon).not.toBeNull()
    if (menuIcon?.parentElement) fireEvent.click(menuIcon.parentElement)
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
