import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectDetailPage from '../page'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  startUpload: vi.fn(() => 'upload-1'),
  mutateAssets: vi.fn(),
  mutateSubfolders: vi.fn(),
  mutateTree: vi.fn(),
  mutateTrash: vi.fn(),
  setLabel: vi.fn(),
  setExtraCrumbs: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'project-1' }),
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams('folder=folder-1'),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    readonly children: React.ReactNode
    readonly href: string
  }) => <a href={href}>{children}</a>,
}))

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/projects/project-1') {
      return {
        data: {
          id: 'project-1',
          name: 'Launch Film',
          description: null,
          created_by: 'user-1',
          project_type: 'personal',
          created_at: '2026-06-30T08:00:00Z',
          deleted_at: null,
        },
        isLoading: false,
      }
    }

    if (key === '/projects/project-1/assets?folder_id=folder-1') {
      return { data: [], isLoading: false, mutate: mocks.mutateAssets }
    }

    if (key === '/projects/project-1/folders?parent_id=folder-1') {
      return { data: [], mutate: mocks.mutateSubfolders }
    }

    if (key === '/projects/project-1/members') {
      return { data: [{ id: 'member-1', user_id: 'user-1', role: 'owner' }] }
    }

    if (key === null) return {}

    return { data: [] }
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/stores/upload-store', () => ({
  useUploadStore: () => ({
    files: [],
    startUpload: mocks.startUpload,
  }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', name: 'Neya', email: 'neya@example.com' },
  }),
}))

vi.mock('@/stores/view-store', () => ({
  useViewStore: () => ({
    rightPanelOpen: false,
  }),
}))

vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: (
    selector: (state: {
      readonly setLabel: typeof mocks.setLabel
      readonly setExtraCrumbs: typeof mocks.setExtraCrumbs
    }) => unknown,
  ) =>
    selector({
      setLabel: mocks.setLabel,
      setExtraCrumbs: mocks.setExtraCrumbs,
    }),
}))

vi.mock('@/hooks/use-page-title', () => ({
  usePageTitle: vi.fn(),
}))

vi.mock('@/hooks/use-comments', () => ({
  useComments: () => ({
    comments: [],
    resolveComment: vi.fn(),
    deleteComment: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    tree: [{ id: 'folder-1', name: 'Renders', children: [], item_count: 0 }],
    mutateTree: mocks.mutateTree,
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    moveFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveAsset: vi.fn(),
    bulkMove: vi.fn(),
    restoreAsset: vi.fn(),
    restoreFolder: vi.fn(),
  }),
  useTrash: () => ({
    trash: { folders: [], assets: [] },
    mutateTrash: mocks.mutateTrash,
  }),
}))

vi.mock('@/components/projects/asset-grid', () => ({
  AssetGrid: () => <div data-testid="asset-grid">Asset grid</div>,
}))

vi.mock('@/components/projects/folder-tree', () => ({
  FolderTree: () => <nav>Folder tree</nav>,
}))

vi.mock('@/components/review/comment-panel', () => ({
  CommentPanel: () => <aside>Comments</aside>,
}))

vi.mock('@/components/upload/upload-zone', () => ({
  UploadZone: () => <div>Upload zone</div>,
}))

vi.mock('@/components/projects/name-dialog', () => ({
  NameDialog: () => null,
}))

vi.mock('@/components/review/share-dialog', () => ({
  BulkSharePanel: () => null,
  SharePanel: () => null,
}))

vi.mock('@/components/projects/project-members-dialog', () => ({
  ProjectMembersDialog: () => null,
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}))

describe('ProjectDetailPage drag-and-drop upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads dropped files into the current folder with extensionless asset names', () => {
    render(<ProjectDetailPage />)

    const file = new File(['cut'], 'hero-final.mov', { type: 'video/quicktime' })
    const dataTransfer = {
      types: ['Files'],
      files: [file],
    }

    fireEvent.dragEnter(screen.getByTestId('asset-grid'), { dataTransfer })

    expect(screen.getByText('Drop files to upload')).toBeInTheDocument()
    expect(screen.getByText(/this folder/i)).toBeInTheDocument()

    fireEvent.drop(screen.getByTestId('asset-grid'), { dataTransfer })

    expect(mocks.startUpload).toHaveBeenCalledWith(
      file,
      'project-1',
      'hero-final',
      'Launch Film',
      'folder-1',
    )
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument()
  })
})
