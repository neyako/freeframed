import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssetGrid } from '../asset-grid'
import type { Asset } from '@/types'
import type {
  AspectRatio,
  CardSize,
  SortDirection,
  SortKey,
  ThumbnailScale,
  TitleLines,
  ViewLayout,
} from '@/stores/view-store'

interface ViewStoreState {
  layout: ViewLayout
  cardSize: CardSize
  aspectRatio: AspectRatio
  thumbnailScale: ThumbnailScale
  showCardInfo: boolean
  titleLines: TitleLines
  flattenFolders: boolean
  showFileSize: boolean
  showUploader: boolean
  sortKey: SortKey
  sortDirection: SortDirection
}

const mocks = vi.hoisted(() => {
  const viewState: ViewStoreState = {
    layout: 'grid',
    cardSize: 'M',
    aspectRatio: 'landscape',
    thumbnailScale: 'fit',
    showCardInfo: true,
    titleLines: '1',
    flattenFolders: false,
    showFileSize: true,
    showUploader: true,
    sortKey: 'custom',
    sortDirection: 'asc',
  }

  return { viewState }
})

vi.mock('@/stores/view-store', () => ({
  useViewStore: () => mocks.viewState,
}))

const asset: Asset = {
  id: 'asset-1',
  project_id: 'project-1',
  name: 'Hero.mov',
  description: null,
  asset_type: 'video',
  status: 'draft',
  rating: null,
  assignee_id: null,
  folder_id: null,
  due_date: null,
  keywords: [],
  created_by: 'user-1',
  created_at: '2026-06-30T08:00:00Z',
  updated_at: '2026-06-30T08:00:00Z',
  deleted_at: null,
}

function resetViewState() {
  Object.assign(mocks.viewState, {
    layout: 'grid',
    cardSize: 'M',
    aspectRatio: 'landscape',
    thumbnailScale: 'fit',
    showCardInfo: true,
    titleLines: '1',
    flattenFolders: false,
    showFileSize: true,
    showUploader: true,
    sortKey: 'custom',
    sortDirection: 'asc',
  } satisfies ViewStoreState)
}

describe('AssetGrid asset activation', () => {
  beforeEach(() => {
    resetViewState()
  })

  it('opens an asset on a single grid click in normal browsing mode', () => {
    const onAssetOpen = vi.fn()
    const onAssetSelect = vi.fn()

    render(
      <AssetGrid
        assets={[asset]}
        projectId="project-1"
        onAssetOpen={onAssetOpen}
        onAssetSelect={onAssetSelect}
      />,
    )

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).toHaveBeenCalledWith(asset)
    expect(onAssetSelect).not.toHaveBeenCalled()
  })

  it('keeps share mode as selection on a single grid click', () => {
    const onAssetOpen = vi.fn()

    render(
      <AssetGrid
        assets={[asset]}
        projectId="project-1"
        shareMode
        onAssetOpen={onAssetOpen}
        onCreateShareLink={vi.fn()}
      />,
    )

    const createShareButton = screen.getByRole('button', {
      name: 'Create Share Link',
    })
    expect(createShareButton).toBeDisabled()

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).not.toHaveBeenCalled()
    expect(createShareButton).toBeEnabled()
  })

  it('opens an asset on a single list-row click in normal browsing mode', () => {
    mocks.viewState.layout = 'list'
    const onAssetOpen = vi.fn()
    const onAssetSelect = vi.fn()

    render(
      <AssetGrid
        assets={[asset]}
        projectId="project-1"
        onAssetOpen={onAssetOpen}
        onAssetSelect={onAssetSelect}
      />,
    )

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).toHaveBeenCalledWith(asset)
    expect(onAssetSelect).not.toHaveBeenCalled()
  })

  it('keeps scoped read-only cards openable without selection or mutation controls', () => {
    const onAssetOpen = vi.fn()
    const { container } = render(
      <AssetGrid
        assets={[asset]}
        projectId="project-1"
        scopedReadOnly
        onAssetOpen={onAssetOpen}
        onAssetShare={vi.fn()}
        onAssetDownload={vi.fn()}
        onAssetRename={vi.fn()}
        onAssetDelete={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkMove={vi.fn()}
        onBulkDownload={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).toHaveBeenCalledWith(asset)
    expect(container.querySelector('[draggable="true"]')).not.toBeInTheDocument()
    expect(screen.queryByText('Download')).not.toBeInTheDocument()
    expect(screen.queryByText('Create Share Link')).not.toBeInTheDocument()
  })

  it('lets scoped read-only browsing dominate share mode and selection', () => {
    const onAssetOpen = vi.fn()
    const { container } = render(
      <AssetGrid
        assets={[asset]}
        projectId="project-1"
        shareMode
        scopedReadOnly
        onAssetOpen={onAssetOpen}
        onCreateShareLink={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).toHaveBeenCalledWith(asset)
    expect(screen.queryByText('Create Share Link')).not.toBeInTheDocument()
    expect(container.querySelector('[draggable]')).not.toBeInTheDocument()
  })

  it('uses capability-accurate empty copy for scoped read-only folders', () => {
    render(
      <AssetGrid
        assets={[]}
        folders={[]}
        projectId="project-1"
        scopedReadOnly
      />,
    )

    expect(screen.getByText('No assets in this folder')).toBeInTheDocument()
    expect(screen.queryByText(/upload your first asset/i)).not.toBeInTheDocument()
  })
})
