'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { X, Download, MoreHorizontal, Share2, Trash2, FolderInput, FolderIcon, Check, Film, Music, Image as ImageIcon, Link as LinkIcon, Pencil } from 'lucide-react'
import { cn, formatBytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { AssetCard } from './asset-card'
import { FolderCard } from './folder-card'
import { AppearancePopover } from './appearance-popover'
import { SortPopover } from './sort-popover'
import { MoveToDialog } from './move-to-dialog'
import { NameDialog } from './name-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  menuContentClass,
  menuItemClass,
  menuItemDangerClass,
  menuSeparatorClass,
} from '@/components/ui/surface'
import { useToast } from '@/components/shared/toast'
import { useViewStore } from '@/stores/view-store'
import type { Asset, AssetResponse, AssetStatus, Folder, FolderTreeNode } from '@/types'
import { mediaAspect } from '@/lib/aspect'

const assetTypeIcons: Record<string, React.ElementType> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
}

const statusOrder: Record<AssetStatus, number> = {
  in_review: 0,
  draft: 1,
  approved: 2,
  rejected: 3,
  archived: 4,
}

interface AssetGridProps {
  assets: AssetResponse[]
  isLoading?: boolean
  thumbnails?: Record<string, string>
  versionCounts?: Record<string, number>
  authorNames?: Record<string, string>
  fileSizes?: Record<string, number>
  onUpload?: () => void
  onAssetOpen?: (asset: Asset) => void
  folders?: Folder[]
  currentFolderId?: string | null
  onFolderOpen?: (folder: Folder) => void
  onFolderRename?: (folderId: string, name: string) => Promise<void>
  onFolderDelete?: (folderId: string) => Promise<void>
  onFolderShare?: (folderId: string, folderName: string) => Promise<void>
  onDropToFolder?: (targetFolderId: string, assetIds: string[], folderIds: string[]) => void
  /** Bulk actions */
  onBulkDelete?: (assetIds: string[], folderIds: string[]) => void
  onBulkMove?: (assetIds: string[], folderIds: string[], targetFolderId: string | null) => void
  onBulkDownload?: (assetIds: string[], folderIds: string[]) => void
  projectName?: string
  folderTree?: FolderTreeNode[]
  onAssetShare?: (asset: Asset) => void
  onAssetDownload?: (asset: Asset) => void
  onAssetRename?: (asset: Asset) => void
  onAssetDelete?: (asset: Asset) => void
  /** Actions rendered on the right side of the navigator bar */
  actions?: React.ReactNode
}

// Justified rows: target row height per card size; each card is as wide as
// its media's shape needs, and rows stretch a little to fill the width.
const rowHeightMap = { S: 140, M: 200, L: 280 }

// Folder cards stay on a plain grid (they have no media shape)
const gridColsMap = {
  S: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  M: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  L: 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2',
}


export function AssetGrid({
  assets,
  isLoading = false,
  thumbnails = {},
  versionCounts = {},
  authorNames = {},
  fileSizes = {},
  onUpload,
  onAssetOpen,
  folders,
  currentFolderId,
  onFolderOpen,
  onFolderRename,
  onFolderDelete,
  onFolderShare,
  onDropToFolder,
  onBulkDelete,
  onBulkMove,
  onBulkDownload,
  projectName = 'Project',
  folderTree = [],
  onAssetShare,
  onAssetDownload,
  onAssetRename,
  onAssetDelete,
  actions,
}: AssetGridProps) {
  const [selectedAssetIds, setSelectedAssetIds] = React.useState<Set<string>>(new Set())
  const [selectedFolderIds, setSelectedFolderIds] = React.useState<Set<string>>(new Set())
  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false)
  const [folderToRename, setFolderToRename] = React.useState<Folder | null>(null)
  const [folderToDelete, setFolderToDelete] = React.useState<Folder | null>(null)
  const toast = useToast()

  const {
    layout,
    cardSize,
    showCardInfo,
    titleLines,
    flattenFolders,
    showFileSize,
    showUploader,
    sortKey,
    sortDirection,
  } = useViewStore()

  const toggleAssetSelect = (assetId: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const toggleFolderSelect = (folderId: string) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const clearSelection = () => {
    setSelectedAssetIds(new Set())
    setSelectedFolderIds(new Set())
  }

  const copyAssetLink = (asset: Asset) => {
    const url = `${window.location.origin}/projects/${asset.project_id}/assets/${asset.id}`
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy link'),
    )
  }

  const totalSelected = selectedAssetIds.size + selectedFolderIds.size
  const selectedTotalSize = Array.from(selectedAssetIds).reduce((sum, id) => sum + (fileSizes[id] ?? 0), 0)

  const filtered = React.useMemo(() => {
    const result = [...assets]

    if (sortKey !== 'custom') {
      result.sort((a, b) => {
        let cmp = 0
        if (sortKey === 'date') {
          cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        } else if (sortKey === 'name') {
          cmp = a.name.localeCompare(b.name)
        } else if (sortKey === 'status') {
          cmp = statusOrder[a.status] - statusOrder[b.status]
        } else if (sortKey === 'type') {
          cmp = a.asset_type.localeCompare(b.asset_type)
        }
        return sortDirection === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [assets, sortKey, sortDirection])

  const showFolders = !flattenFolders && folders && folders.length > 0
  const folderCount = showFolders ? folders!.length : 0

  if (isLoading) {
    return <p className="text-[13px] text-text-tertiary">Loading…</p>
  }

  const countLabel = [
    folderCount > 0 ? `${folderCount} folder${folderCount !== 1 ? 's' : ''}` : null,
    `${filtered.length} file${filtered.length !== 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const rowMenuTrigger = (label: string) => (
    <DropdownMenu.Trigger asChild>
      <button
        aria-label={`${label} options`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary outline-none transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
      >
        <MoreHorizontal className="h-[15px] w-[15px]" />
      </button>
    </DropdownMenu.Trigger>
  )

  return (
    <div className="relative flex flex-col gap-3">
      {/* Toolbar: count, view + sort, page actions */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-[12.5px] text-text-secondary">{countLabel}</span>
        <div className="grow" />
        <SortPopover />
        <div className="hidden lg:block">
          <AppearancePopover />
        </div>
        {actions && <div className="ml-1 flex items-center gap-2">{actions}</div>}
      </div>

      {/* Grid view: folders */}
      {showFolders && layout === 'grid' && (
        <div className={cn('grid gap-x-3 gap-y-4', gridColsMap[cardSize])}>
          {folders!.map((folder) => {
            const isFolderSelected = selectedFolderIds.has(folder.id)
            return (
              <div key={folder.id} className="group/folder relative">
                <button
                  type="button"
                  aria-label={isFolderSelected ? `Deselect ${folder.name}` : `Select ${folder.name}`}
                  aria-pressed={isFolderSelected}
                  className={cn(
                    'absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-sm transition-colors duration-100',
                    isFolderSelected
                      ? 'bg-text-primary text-bg-primary'
                      : 'bg-black/60 text-transparent opacity-0 group-hover/folder:opacity-100 group-hover/folder:text-white/60 pointer-coarse:opacity-100',
                  )}
                  onClick={(e) => { e.stopPropagation(); toggleFolderSelect(folder.id) }}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <FolderCard
                  folder={folder}
                  onOpen={onFolderOpen!}
                  onRename={onFolderRename}
                  onDelete={onFolderDelete}
                  onShare={onFolderShare}
                  onDropItems={onDropToFolder}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Assets */}
      {filtered.length === 0 && !showFolders ? (
        <EmptyState
          title="No files yet."
          action={onUpload ? { label: 'Upload', onClick: onUpload } : undefined}
        />
      ) : layout === 'grid' && filtered.length > 0 ? (
        <div className={cn('flex flex-wrap gap-x-3 gap-y-4', showFolders && 'mt-3')}>
          {filtered.map((asset) => {
            const aspect = mediaAspect(asset)
            return (
            <div
              key={asset.id}
              className="min-w-0"
              style={{ flexGrow: aspect, flexBasis: aspect * rowHeightMap[cardSize] }}
              onClick={() => onAssetOpen?.(asset)}
            >
              <AssetCard
                asset={asset}
                versionCount={versionCounts[asset.id]}
                authorName={authorNames[asset.created_by]}
                thumbnailUrl={thumbnails[asset.id]}
                fileSize={fileSizes[asset.id] ?? null}
                selected={selectedAssetIds.has(asset.id)}
                onSelect={() => toggleAssetSelect(asset.id)}
                showInfo={showCardInfo}
                showFileSize={showFileSize}
                showUploader={showUploader}
                titleLines={titleLines}
                aspect={aspect}
                onShare={onAssetShare ? () => onAssetShare(asset) : undefined}
                onDownload={onAssetDownload ? () => onAssetDownload(asset) : undefined}
                onRename={onAssetRename ? () => onAssetRename(asset) : undefined}
                onDelete={onAssetDelete ? () => onAssetDelete(asset) : undefined}
                onDragStart={(e: React.DragEvent) => {
                  const ids = selectedAssetIds.has(asset.id)
                    ? Array.from(selectedAssetIds)
                    : [asset.id]
                  e.dataTransfer.setData(
                    'application/json',
                    JSON.stringify({ assetIds: ids, folderIds: [] }),
                  )
                  e.dataTransfer.effectAllowed = 'move'
                }}
              />
            </div>
            )
          })}
          {/* Absorbs the last row's spare width so its cards keep row height */}
          <div aria-hidden className="h-0" style={{ flexGrow: 1e6, flexBasis: 0 }} />
        </div>
      ) : layout === 'list' && (showFolders || filtered.length > 0) ? (
        /* Unified list view (folders + assets) */
        <div className="divide-y divide-border border-y border-border">
          <div className="flex h-8 items-center gap-3 px-2 text-[12px] text-text-tertiary">
            <div className="w-8 shrink-0" />
            <div className="min-w-0 flex-1">Name</div>
            {showUploader && <div className="hidden w-32 md:block">Uploader</div>}
            {showFileSize && <div className="hidden w-20 text-right sm:block">Size</div>}
            <div className="hidden w-10 text-center md:block">Ver.</div>
            <div className="hidden w-24 sm:block">Date</div>
            <div className="w-6 shrink-0" />
          </div>

          {showFolders && folders!.map((folder) => {
            const isFolderSelected = selectedFolderIds.has(folder.id)
            return (
              <div
                key={folder.id}
                className={cn(
                  'group flex h-11 cursor-pointer items-center gap-3 px-2 transition-colors duration-100 hover:bg-bg-hover',
                  isFolderSelected && 'bg-bg-hover',
                )}
                onClick={() => onFolderOpen?.(folder)}
              >
                <SelectableThumb
                  selected={isFolderSelected}
                  label={folder.name}
                  onToggle={() => toggleFolderSelect(folder.id)}
                >
                  <FolderIcon className="h-[15px] w-[15px] text-text-tertiary" />
                </SelectableThumb>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text-primary">{folder.name}</p>
                </div>
                {showUploader && <div className="hidden w-32 md:block" />}
                {showFileSize && (
                  <div className="hidden w-20 text-right font-mono text-[12px] text-text-tertiary sm:block">
                    {folder.item_count ?? 0} item{(folder.item_count ?? 0) !== 1 ? 's' : ''}
                  </div>
                )}
                <div className="hidden w-10 md:block" />
                <div className="hidden w-24 shrink-0 font-mono text-[12px] text-text-tertiary sm:block">
                  {formatShortDate(folder.created_at)}
                </div>
                <div className="flex w-6 shrink-0 justify-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                  <DropdownMenu.Root>
                    {rowMenuTrigger(folder.name)}
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass} onClick={(e) => e.stopPropagation()}>
                        {onFolderShare && (
                          <DropdownMenu.Item onSelect={() => onFolderShare(folder.id, folder.name)} className={menuItemClass}>
                            <Share2 />
                            Share
                          </DropdownMenu.Item>
                        )}
                        {onFolderRename && (
                          <DropdownMenu.Item onSelect={() => setFolderToRename(folder)} className={menuItemClass}>
                            <Pencil />
                            Rename
                          </DropdownMenu.Item>
                        )}
                        {onFolderDelete && (
                          <DropdownMenu.Item onSelect={() => setFolderToDelete(folder)} className={menuItemDangerClass}>
                            <Trash2 />
                            Delete
                          </DropdownMenu.Item>
                        )}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
            )
          })}
          {filtered.map((asset) => {
            const thumb = thumbnails[asset.id]
            const fileSize = fileSizes[asset.id]
            const versionCount = versionCounts[asset.id]
            const author = authorNames[asset.created_by]
            const TypeIcon = assetTypeIcons[asset.asset_type] ?? ImageIcon
            const isSelected = selectedAssetIds.has(asset.id)
            return (
              <div
                key={asset.id}
                onClick={() => onAssetOpen?.(asset)}
                className={cn(
                  'group flex h-11 cursor-pointer items-center gap-3 px-2 transition-colors duration-100 hover:bg-bg-hover',
                  isSelected && 'bg-bg-hover',
                )}
              >
                <SelectableThumb selected={isSelected} label={asset.name} onToggle={() => toggleAssetSelect(asset.id)}>
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={asset.name} className="h-full w-full object-cover" />
                  ) : (
                    <TypeIcon className="h-[15px] w-[15px] text-text-tertiary" />
                  )}
                </SelectableThumb>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text-primary">{asset.name}</p>
                </div>
                {showUploader && (
                  <div className="hidden w-32 shrink-0 truncate text-[12.5px] text-text-secondary md:block">
                    {author}
                  </div>
                )}
                {showFileSize && (
                  <div className="hidden w-20 shrink-0 text-right font-mono text-[12px] text-text-secondary sm:block">
                    {fileSize ? formatBytes(fileSize) : ''}
                  </div>
                )}
                <div className="hidden w-10 shrink-0 text-center font-mono text-[12px] text-text-secondary md:block">
                  v{versionCount ?? 1}
                </div>
                <div className="hidden w-24 shrink-0 font-mono text-[12px] text-text-tertiary sm:block">
                  {formatShortDate(asset.created_at)}
                </div>
                <div className="flex w-6 shrink-0 justify-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                  <DropdownMenu.Root>
                    {rowMenuTrigger(asset.name)}
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass} onClick={(e) => e.stopPropagation()}>
                        {onAssetShare && (
                          <DropdownMenu.Item onSelect={() => onAssetShare(asset)} className={menuItemClass}>
                            <Share2 />
                            Share
                          </DropdownMenu.Item>
                        )}
                        {onAssetDownload && (
                          <DropdownMenu.Item onSelect={() => onAssetDownload(asset)} className={menuItemClass}>
                            <Download />
                            Download
                          </DropdownMenu.Item>
                        )}
                        <DropdownMenu.Item onSelect={() => copyAssetLink(asset)} className={menuItemClass}>
                          <LinkIcon />
                          Copy link
                        </DropdownMenu.Item>
                        {(onAssetRename || onAssetDelete) && <DropdownMenu.Separator className={menuSeparatorClass} />}
                        {onAssetRename && (
                          <DropdownMenu.Item onSelect={() => onAssetRename(asset)} className={menuItemClass}>
                            <Pencil />
                            Rename
                          </DropdownMenu.Item>
                        )}
                        {onAssetDelete && (
                          <DropdownMenu.Item onSelect={() => onAssetDelete(asset)} className={menuItemDangerClass}>
                            <Trash2 />
                            Delete
                          </DropdownMenu.Item>
                        )}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Selection action bar */}
      {totalSelected > 0 && (
        <div className="sticky bottom-3 z-20 flex items-center gap-2 rounded-md border border-border-strong bg-bg-elevated py-1.5 pl-1.5 pr-2 shadow-xl">
          <Button variant="ghost" size="sm" className="w-[30px] px-0" onClick={clearSelection} aria-label="Clear selection">
            <X />
          </Button>
          <span className="text-[13px] text-text-primary">{totalSelected} selected</span>
          {selectedTotalSize > 0 && (
            <span className="font-mono text-[12px] text-text-tertiary">{formatBytes(selectedTotalSize)}</span>
          )}
          <div className="flex-1" />
          {onBulkDownload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onBulkDownload(Array.from(selectedAssetIds), Array.from(selectedFolderIds))}
            >
              <Download /> Download
            </Button>
          )}
          {onBulkMove && (
            <Button variant="ghost" size="sm" onClick={() => setMoveDialogOpen(true)}>
              <FolderInput /> Move to
            </Button>
          )}
          {onBulkDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="hover:text-accent"
              onClick={() => onBulkDelete(Array.from(selectedAssetIds), Array.from(selectedFolderIds))}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      )}

      <MoveToDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        projectName={projectName}
        tree={folderTree}
        currentFolderId={currentFolderId ?? null}
        movingFolderIds={Array.from(selectedFolderIds)}
        onMove={(targetFolderId) => {
          onBulkMove?.(Array.from(selectedAssetIds), Array.from(selectedFolderIds), targetFolderId)
          clearSelection()
        }}
      />

      <NameDialog
        open={folderToRename !== null}
        onOpenChange={(open) => { if (!open) setFolderToRename(null) }}
        title="Rename folder"
        placeholder="Folder name"
        defaultValue={folderToRename?.name ?? ''}
        submitLabel="Rename"
        onSubmit={(name) => {
          if (folderToRename) void onFolderRename?.(folderToRename.id, name)
        }}
      />

      <ConfirmDialog
        open={folderToDelete !== null}
        onOpenChange={(open) => { if (!open) setFolderToDelete(null) }}
        title={`Delete "${folderToDelete?.name ?? ''}"?`}
        description="The folder and its contents move to trash, where you can restore them."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (folderToDelete) await onFolderDelete?.(folderToDelete.id)
        }}
      />
    </div>
  )
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** 32px list thumbnail with a select checkbox overlaid on hover/selection. */
function SelectableThumb({
  selected,
  label,
  onToggle,
  children,
}: {
  selected: boolean
  label: string
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
      {children}
      <button
        type="button"
        aria-label={selected ? `Deselect ${label}` : `Select ${label}`}
        aria-pressed={selected}
        className={cn(
          'absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-100',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
        )}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
      >
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-sm',
            selected ? 'bg-text-primary text-bg-primary' : 'border border-white/50',
          )}
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
      </button>
    </div>
  )
}
