import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectDetailPage from '../page'

const mocks = vi.hoisted(() => ({
  folderQuery: null as string | null,
  projectLoaded: true,
  projectDenied: false,
  projectStaleData: false,
  treeLoading: false,
  swrKeys: [] as string[],
  routerPush: vi.fn(),
  trashEnabled: [] as boolean[],
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'project-1' }),
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams(mocks.folderQuery ? `folder=${mocks.folderQuery}` : ''),
}))

vi.mock('next/link', () => ({ default: ({ children }: { readonly children: React.ReactNode }) => children }))

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) mocks.swrKeys.push(key)
    if (key === '/projects/project-1') {
      return {
        data: mocks.projectLoaded && (!mocks.projectDenied || mocks.projectStaleData) ? {
          id: 'project-1',
          name: 'Scoped project',
          description: null,
          created_by: 'owner-1',
          project_type: 'personal',
          created_at: '2026-07-12T00:00:00Z',
          role: null,
          folder_access: {
            kind: 'folder_direct',
            accessible_root_ids: ['folder-a'],
            grants: [{ folder_id: 'folder-a', permission: 'comment' }],
          },
        } : undefined,
        error: mocks.projectDenied ? { status: 403, detail: 'Not a project member' } : undefined,
        isLoading: !mocks.projectLoaded && !mocks.projectDenied,
      }
    }
    if (key?.includes('/assets')) return { data: [], isLoading: false, mutate: vi.fn() }
    if (key?.includes('/folders')) return { data: [], mutate: vi.fn() }
    return { data: [] }
  },
}))

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/upload-store', () => ({ useUploadStore: () => ({ files: [], startUpload: vi.fn() }) }))
vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'recipient-1' } }) }))
vi.mock('@/stores/view-store', () => ({ useViewStore: () => ({ rightPanelOpen: false }) }))
vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: (selector: (state: { readonly setLabel: () => void; readonly setExtraCrumbs: () => void }) => unknown) =>
    selector({ setLabel: vi.fn(), setExtraCrumbs: vi.fn() }),
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/use-comments', () => ({
  useComments: () => ({ comments: [], resolveComment: vi.fn(), deleteComment: vi.fn(), addReaction: vi.fn(), removeReaction: vi.fn() }),
}))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    tree: mocks.treeLoading
      ? []
      : [{ id: 'folder-a', name: 'Shared A', parent_id: null, item_count: 0, children: [] }],
    isLoading: mocks.treeLoading,
    mutateTree: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), moveFolder: vi.fn(),
    deleteFolder: vi.fn(), moveAsset: vi.fn(), bulkMove: vi.fn(), restoreAsset: vi.fn(), restoreFolder: vi.fn(),
  }),
  useTrash: (_projectId: string, enabled = true) => {
    mocks.trashEnabled.push(enabled)
    return { trash: { folders: [], assets: [] }, mutateTrash: vi.fn() }
  },
}))
vi.mock('@/components/projects/asset-grid', () => ({ AssetGrid: () => <div>Scoped asset grid</div> }))
vi.mock('@/components/projects/folder-tree', () => ({ FolderTree: () => <nav>Scoped folder tree</nav> }))
vi.mock('@/components/review/comment-panel', () => ({ CommentPanel: () => <aside>Comments</aside> }))
vi.mock('@/components/upload/upload-zone', () => ({ UploadZone: () => <div>Upload zone</div> }))
vi.mock('@/components/projects/name-dialog', () => ({ NameDialog: () => null }))
vi.mock('@/components/review/share-dialog', () => ({ BulkSharePanel: () => null, SharePanel: () => null }))
vi.mock('@/components/projects/project-members-dialog', () => ({ ProjectMembersDialog: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }))

describe('ProjectDetailPage folder-direct access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.swrKeys.length = 0
    mocks.trashEnabled.length = 0
    mocks.folderQuery = null
    mocks.projectLoaded = true
    mocks.projectDenied = false
    mocks.projectStaleData = false
    mocks.treeLoading = false
  })

  it('selects first authorized root and never fetches members, trash, root assets, or user batches', () => {
    render(<ProjectDetailPage />)

    expect(mocks.routerPush).toHaveBeenCalledWith('/projects/project-1?folder=folder-a')
    expect(mocks.swrKeys.some((key) => key.includes('/members'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/users/batch'))).toBe(false)
    expect(mocks.swrKeys).not.toContain('/projects/project-1/assets?folder_id=root')
    expect(mocks.trashEnabled.length).toBeGreaterThan(0)
    expect(mocks.trashEnabled.every((enabled) => !enabled)).toBe(true)
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Share')).not.toBeInTheDocument()
  })

  it('denies explicit out-of-scope folder before collection fetch', () => {
    mocks.folderQuery = 'folder-sibling'
    render(<ProjectDetailPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(mocks.swrKeys.some((key) => key.includes('/assets?'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/folders?'))).toBe(false)
  })

  it('waits for the project envelope before fetching an explicit folder', () => {
    mocks.folderQuery = 'folder-sibling'
    mocks.projectLoaded = false
    const { rerender } = render(<ProjectDetailPage />)

    expect(mocks.swrKeys.some((key) => key.includes('/assets?'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/folders?'))).toBe(false)

    mocks.projectLoaded = true
    rerender(<ProjectDetailPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(mocks.swrKeys.some((key) => key.includes('/assets?'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/folders?'))).toBe(false)
  })

  it('renders access denied instead of an unscoped project shell after revocation', () => {
    mocks.folderQuery = 'folder-a'
    mocks.projectDenied = true
    render(<ProjectDetailPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByText('Scoped asset grid')).not.toBeInTheDocument()
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
  })

  it('lets a revocation error override retained project data', () => {
    mocks.folderQuery = 'folder-a'
    mocks.projectDenied = true
    mocks.projectStaleData = true
    render(<ProjectDetailPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByText('Scoped asset grid')).not.toBeInTheDocument()
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
    expect(mocks.swrKeys.some((key) => key.includes('/assets?'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/folders?'))).toBe(false)
  })

  it('does not deny a valid deep link while the scoped tree is loading', () => {
    mocks.folderQuery = 'folder-a'
    mocks.treeLoading = true
    render(<ProjectDetailPage />)

    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument()
    expect(mocks.swrKeys.some((key) => key.includes('/assets?'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/folders?'))).toBe(false)
  })
})
