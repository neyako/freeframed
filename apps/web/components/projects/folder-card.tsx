'use client'

import React, { useCallback, useState } from 'react'
import useSWR from 'swr'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Folder, Film, Music, Image as ImageIcon, MoreHorizontal, Pencil, Trash2, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { NameDialog } from './name-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  menuContentClass,
  menuItemClass,
  menuItemDangerClass,
  menuSeparatorClass,
} from '@/components/ui/surface'
import type { Folder as FolderType, AssetResponse } from '@/types'

const assetTypeIcons = {
  video: Film,
  audio: Music,
  image: ImageIcon,
} as const

function ThumbCell({ asset, className }: { asset: AssetResponse; className?: string }) {
  const [failed, setFailed] = React.useState(false)
  const TypeIcon = assetTypeIcons[asset.asset_type as keyof typeof assetTypeIcons] ?? ImageIcon

  if (failed || !asset.thumbnail_url) {
    return (
      <div className={cn('overflow-hidden bg-bg-tertiary flex items-center justify-center', className)}>
        <TypeIcon className="h-[15px] w-[15px] text-text-tertiary" />
      </div>
    )
  }

  return (
    <div className={cn('overflow-hidden bg-bg-tertiary', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.thumbnail_url}
        alt={asset.name}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  )
}

function FolderThumbnails({ projectId, folderId, itemCount }: { projectId: string; folderId: string; itemCount: number }) {
  const { data: assets } = useSWR<AssetResponse[]>(
    itemCount > 0 ? `/projects/${projectId}/assets?folder_id=${folderId}` : null,
    (key: string) => api.get<AssetResponse[]>(key),
    { revalidateOnFocus: false },
  )

  // Prefer assets with thumbnails first, fill with any up to 3
  const sorted = [...(assets ?? [])].sort((a, b) => (b.thumbnail_url ? 1 : 0) - (a.thumbnail_url ? 1 : 0))
  const thumbs = sorted.slice(0, 3)

  if (thumbs.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm border border-border bg-bg-tertiary transition-colors duration-100 group-hover:border-border-strong">
        <Folder className="h-[15px] w-[15px] text-text-tertiary" />
      </div>
    )
  }

  return (
    <div className={cn(
      'grid aspect-[4/3] gap-px overflow-hidden rounded-sm border border-border bg-bg-tertiary transition-colors duration-100 group-hover:border-border-strong',
      thumbs.length === 1 && 'grid-cols-1',
      thumbs.length >= 2 && 'grid-cols-2',
    )}>
      {thumbs.map((asset, i) => (
        <ThumbCell
          key={asset.id}
          asset={asset}
          className={thumbs.length === 3 && i === 0 ? 'row-span-2' : undefined}
        />
      ))}
    </div>
  )
}

interface FolderCardProps {
  folder: FolderType
  onOpen: (folder: FolderType) => void
  onRename?: (folderId: string, name: string) => Promise<void>
  onDelete?: (folderId: string) => Promise<void>
  onShare?: (folderId: string, folderName: string) => Promise<void>
  onDropItems?: (targetFolderId: string, assetIds: string[], folderIds: string[]) => void
  className?: string
}

export function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
  onShare,
  onDropItems,
  className,
}: FolderCardProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Draggable
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({ folderIds: [folder.id], assetIds: [] }),
      )
      e.dataTransfer.effectAllowed = 'move'
    },
    [folder.id],
  )

  // Drop target
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'))
        // Don't allow dropping a folder onto itself
        if (data.folderIds?.includes(folder.id)) return
        onDropItems?.(folder.id, data.assetIds ?? [], data.folderIds ?? [])
      } catch {}
    },
    [folder.id, onDropItems],
  )

  return (
    <>
      <div
        className={cn('group relative cursor-pointer', isDragOver && 'opacity-60', className)}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => onOpen(folder)}
      >
        <FolderThumbnails projectId={folder.project_id} folderId={folder.id} itemCount={folder.item_count} />

        <div className="mt-1.5 flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] text-text-primary">{folder.name}</p>
            <p className="font-mono text-[11.5px] text-text-tertiary">
              {folder.item_count} {folder.item_count === 1 ? 'item' : 'items'}
            </p>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={`${folder.name} options`}
                onClick={(e) => e.stopPropagation()}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary opacity-0 outline-none transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <MoreHorizontal className="h-[15px] w-[15px]" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className={menuContentClass}
                onClick={(e) => e.stopPropagation()}
              >
                {onShare && (
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => onShare(folder.id, folder.name)}>
                    <Share2 />
                    Share
                  </DropdownMenu.Item>
                )}
                {onRename && (
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => setRenameOpen(true)}>
                    <Pencil />
                    Rename
                  </DropdownMenu.Item>
                )}
                {onDelete && (
                  <>
                    <DropdownMenu.Separator className={menuSeparatorClass} />
                    <DropdownMenu.Item className={menuItemDangerClass} onSelect={() => setDeleteOpen(true)}>
                      <Trash2 />
                      Delete
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* Rename dialog */}
      <NameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename folder"
        placeholder="Folder name"
        defaultValue={folder.name}
        submitLabel="Rename"
        onSubmit={(name) => onRename?.(folder.id, name)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${folder.name}"?`}
        description="The folder and its contents move to trash, where you can restore them."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => onDelete?.(folder.id)}
      />
    </>
  )
}
