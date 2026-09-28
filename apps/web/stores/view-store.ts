import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewLayout = 'grid' | 'list'
export type CardSize = 'S' | 'M' | 'L'
export type TitleLines = '1' | '2' | '3'
export type SortKey = 'custom' | 'date' | 'name' | 'status' | 'type'
export type SortDirection = 'asc' | 'desc'

interface ViewSettings {
  layout: ViewLayout
  cardSize: CardSize
  showCardInfo: boolean
  titleLines: TitleLines
  flattenFolders: boolean
  showFileSize: boolean
  showUploader: boolean
  sortKey: SortKey
  sortDirection: SortDirection
  leftPanelOpen: boolean
}

interface ViewStore extends ViewSettings {
  setLayout: (layout: ViewLayout) => void
  setCardSize: (size: CardSize) => void
  setShowCardInfo: (show: boolean) => void
  setTitleLines: (lines: TitleLines) => void
  setFlattenFolders: (flatten: boolean) => void
  setShowFileSize: (show: boolean) => void
  setShowUploader: (show: boolean) => void
  setSortKey: (key: SortKey) => void
  setSortDirection: (dir: SortDirection) => void
  toggleSortDirection: () => void
  toggleLeftPanel: () => void
}

export const useViewStore = create<ViewStore>()(
  persist(
    (set) => ({
      layout: 'grid',
      cardSize: 'M',
      showCardInfo: true,
      titleLines: '1',
      flattenFolders: false,
      showFileSize: true,
      showUploader: true,
      sortKey: 'date',
      sortDirection: 'desc',
      leftPanelOpen: true,

      setLayout: (layout) => set({ layout }),
      setCardSize: (size) => set({ cardSize: size }),
      setShowCardInfo: (show) => set({ showCardInfo: show }),
      setTitleLines: (lines) => set({ titleLines: lines }),
      setFlattenFolders: (flatten) => set({ flattenFolders: flatten }),
      setShowFileSize: (show) => set({ showFileSize: show }),
      setShowUploader: (show) => set({ showUploader: show }),
      setSortKey: (key) => set({ sortKey: key }),
      setSortDirection: (dir) => set({ sortDirection: dir }),
      toggleSortDirection: () =>
        set((s) => ({ sortDirection: s.sortDirection === 'asc' ? 'desc' : 'asc' })),
      toggleLeftPanel: () =>
        set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
    }),
    { name: 'freeframe-view-settings' },
  ),
)
