import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssetGrid } from '../asset-grid'
import type { AssetResponse } from '@/types'
import type {
  CardSize,
  SortDirection,
  SortKey,
  TitleLines,
  ViewLayout,
} from '@/stores/view-store'

interface ViewStoreState {
  layout: ViewLayout
  cardSize: CardSize
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

vi.mock('@/components/shared/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/stores/view-store', () => ({
  useViewStore: () => mocks.viewState,
}))

const asset: AssetResponse = {
  id: 'asset-1',
  project_id: 'project-1',
  name: 'Hero.mov',
  description: null,
  asset_type: 'video',
  status: 'draft',
  folder_id: null,
  created_by: 'user-1',
  created_at: '2026-06-30T08:00:00Z',
  updated_at: '2026-06-30T08:00:00Z',
  deleted_at: null,
  latest_version: null,
  thumbnail_url: null,
}

function resetViewState() {
  Object.assign(mocks.viewState, {
    layout: 'grid',
    cardSize: 'M',
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

  it('opens an asset on a single grid click', () => {
    const onAssetOpen = vi.fn()

    render(<AssetGrid assets={[asset]} onAssetOpen={onAssetOpen} />)

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).toHaveBeenCalledTimes(1)
    expect(onAssetOpen).toHaveBeenCalledWith(asset)
  })

  it('opens an asset on a single list-row click', () => {
    mocks.viewState.layout = 'list'
    const onAssetOpen = vi.fn()

    render(<AssetGrid assets={[asset]} onAssetOpen={onAssetOpen} />)

    fireEvent.click(screen.getByText('Hero.mov'))

    expect(onAssetOpen).toHaveBeenCalledTimes(1)
    expect(onAssetOpen).toHaveBeenCalledWith(asset)
  })
})
