'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Film, Music, Image as ImageIcon, MessageSquare, MoreHorizontal, Check, Share2, Download, Link as LinkIcon, Pencil, Trash2 } from 'lucide-react'
import { cn, formatRelativeTime, formatBytes } from '@/lib/utils'
import {
  menuContentClass,
  menuItemClass,
  menuItemDangerClass,
  menuSeparatorClass,
} from '@/components/ui/surface'
import { useToast } from '@/components/shared/toast'
import type { Asset, AssetType } from '@/types'
import type { TitleLines } from '@/stores/view-store'

const assetTypeIcons: Record<AssetType, React.ElementType> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
}

interface AssetCardProps {
  asset: Asset
  versionCount?: number
  authorName?: string
  thumbnailUrl?: string | null
  commentCount?: number
  duration?: number | null
  selected?: boolean
  onSelect?: (e: React.MouseEvent) => void
  onDragStart?: (e: React.DragEvent) => void
  onShare?: () => void
  onDownload?: () => void
  onRename?: () => void
  onDelete?: () => void
  fileSize?: number | null
  // Appearance settings
  showInfo?: boolean
  showFileSize?: boolean
  showUploader?: boolean
  titleLines?: TitleLines
  /** Media width / height: the thumbnail keeps the real shape (vertical stays vertical) */
  aspect?: number
  className?: string
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rm = m % 60
    return `${h}:${String(rm).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function AssetCard({
  asset,
  versionCount = 1,
  authorName,
  thumbnailUrl,
  commentCount,
  duration,
  selected = false,
  onSelect,
  onDragStart,
  onShare,
  onDownload,
  onRename,
  onDelete,
  fileSize,
  showInfo = true,
  showFileSize = true,
  showUploader = true,
  titleLines = '1',
  aspect = 16 / 9,
  className,
}: AssetCardProps) {
  const TypeIcon = assetTypeIcons[asset.asset_type]
  const lineClamp = titleLines === '1' ? 'line-clamp-1' : titleLines === '2' ? 'line-clamp-2' : 'line-clamp-3'
  const [imgError, setImgError] = React.useState(false)
  const toast = useToast()

  const meta = [
    versionCount > 1 ? `v${versionCount}` : null,
    showUploader && authorName ? authorName : null,
    formatRelativeTime(asset.created_at),
    showFileSize && fileSize ? formatBytes(fileSize) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn('group flex cursor-pointer flex-col', className)}
    >
      {/* Thumbnail area */}
      <div
        className={cn(
          'relative flex w-full items-center justify-center overflow-hidden rounded-sm border bg-bg-tertiary transition-colors duration-100',
          selected ? 'border-text-primary' : 'border-border group-hover:border-border-strong',
        )}
        style={{ aspectRatio: aspect }}
      >
        {thumbnailUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={asset.name}
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <TypeIcon className="h-[15px] w-[15px] text-text-tertiary" />
        )}

        {onSelect && (
          <button
            type="button"
            aria-label={selected ? `Deselect ${asset.name}` : `Select ${asset.name}`}
            aria-pressed={selected}
            onClick={(e) => { e.stopPropagation(); onSelect(e) }}
            className={cn(
              'absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm transition-colors duration-100',
              selected
                ? 'bg-text-primary text-bg-primary'
                : 'bg-black/60 text-white/60 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}

        {duration != null && duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/70 px-1 font-mono text-2xs tabular-nums text-white">
            {formatDuration(duration)}
          </span>
        )}

        {commentCount != null && commentCount > 0 && (
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-sm bg-black/70 px-1 font-mono text-2xs text-white">
            <MessageSquare className="h-3 w-3" />
            {commentCount}
          </span>
        )}
      </div>

      {showInfo && (
        <div className="mt-1.5 flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <p className={cn('text-[12.5px] leading-snug text-text-primary', lineClamp)}>
              {asset.name}
            </p>
            <p className="truncate font-mono text-[11.5px] text-text-tertiary">{meta}</p>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={`${asset.name} options`}
                onClick={(e) => e.stopPropagation()}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary opacity-0 outline-none transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:h-7 pointer-coarse:w-7 pointer-coarse:opacity-100"
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
                  <DropdownMenu.Item onSelect={onShare} className={menuItemClass}>
                    <Share2 />
                    Share
                  </DropdownMenu.Item>
                )}
                {onDownload && (
                  <DropdownMenu.Item onSelect={onDownload} className={menuItemClass}>
                    <Download />
                    Download
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  onSelect={() => {
                    const url = `${window.location.origin}/projects/${asset.project_id}/assets/${asset.id}`
                    navigator.clipboard.writeText(url).then(
                      () => toast.success('Link copied'),
                      () => toast.error('Could not copy link'),
                    )
                  }}
                  className={menuItemClass}
                >
                  <LinkIcon />
                  Copy link
                </DropdownMenu.Item>
                {(onRename || onDelete) && <DropdownMenu.Separator className={menuSeparatorClass} />}
                {onRename && (
                  <DropdownMenu.Item onSelect={onRename} className={menuItemClass}>
                    <Pencil />
                    Rename
                  </DropdownMenu.Item>
                )}
                {onDelete && (
                  <DropdownMenu.Item onSelect={onDelete} className={menuItemDangerClass}>
                    <Trash2 />
                    Delete
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
    </div>
  )
}
