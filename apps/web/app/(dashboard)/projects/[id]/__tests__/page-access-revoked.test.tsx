import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectDetailPage from '../page'

const mocks = vi.hoisted(() => ({
  projectStaleData: false,
  swrKeys: [] as string[],
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'project-1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('folder=folder-a'),
}))

vi.mock('next/link', () => ({ default: ({ children }: { readonly children: React.ReactNode }) => children }))

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) mocks.swrKeys.push(key)
    if (key === '/projects/project-1') {
      return {
        data: mocks.projectStaleData ? {
          id: 'project-1',
          name: 'Editor project',
          description: null,
          created_by: 'owner-1',
          created_at: '2026-07-12T00:00:00Z',
          role: 'editor',
        } : undefined,
        error: { status: 403, detail: 'Not a project member' },
        isLoading: false,
      }
    }
    if (key?.includes('/assets')) return { data: [], isLoading: false, mutate: vi.fn() }
    if (key?.includes('/folders')) return { data: [], mutate: vi.fn() }
    return { data: [] }
  },
}))

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/upload-store', () => ({ useUploadStore: () => ({ files: [], startUpload: vi.fn() }) }))
vi.mock('@/stores/view-store', () => ({ useViewStore: () => ({ leftPanelOpen: false, toggleLeftPanel: vi.fn() }) }))
vi.mock('@/components/shared/toast', () => ({ useToast: () => ({ error: vi.fn() }) }))
vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: (selector: (state: { readonly setLabel: () => void; readonly setExtraCrumbs: () => void }) => unknown) =>
    selector({ setLabel: vi.fn(), setExtraCrumbs: vi.fn() }),
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    tree: [{ id: 'folder-a', name: 'Shared A', parent_id: null, item_count: 0, children: [] }],
    mutateTree: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), moveFolder: vi.fn(),
    deleteFolder: vi.fn(), moveAsset: vi.fn(), bulkMove: vi.fn(), restoreAsset: vi.fn(), restoreFolder: vi.fn(),
  }),
  useTrash: () => ({ trash: { folders: [], assets: [] }, mutateTrash: vi.fn() }),
}))
vi.mock('@/components/projects/asset-grid', () => ({ AssetGrid: () => <div>Asset grid</div> }))
vi.mock('@/components/projects/folder-tree', () => ({ FolderTree: () => <nav>Folder tree</nav> }))
vi.mock('@/components/projects/name-dialog', () => ({ NameDialog: () => null }))
vi.mock('@/components/review/share-link-section', () => ({ SingleLinkSection: () => null }))
vi.mock('@/components/projects/project-members-dialog', () => ({ ProjectMembersDialog: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }))

describe('ProjectDetailPage revoked access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.swrKeys.length = 0
    mocks.projectStaleData = false
  })

  it('renders access denied instead of the project shell after revocation', () => {
    render(<ProjectDetailPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByText('Asset grid')).not.toBeInTheDocument()
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
  })

  it('lets a revocation error override retained project data', () => {
    mocks.projectStaleData = true
    render(<ProjectDetailPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByText('Asset grid')).not.toBeInTheDocument()
    expect(screen.queryByText('Upload')).not.toBeInTheDocument()
    expect(mocks.swrKeys.some((key) => key.includes('/assets?'))).toBe(false)
    expect(mocks.swrKeys.some((key) => key.includes('/folders?'))).toBe(false)
  })
})
