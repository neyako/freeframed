'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { X, Link, Check, Film, Music, Image as ImageIcon, FileIcon } from 'lucide-react'
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils'
import {
  getUploadDisplayProgress,
  isQuickShareUpload,
  useUploadStore,
  type UploadFile,
  type UploadStatus,
} from '@/stores/upload-store'
import { ProgressTrack } from '@/components/ui/progress'

function FileTypeIcon({ fileType }: { fileType: string }) {
  const Icon = fileType.startsWith('video/')
    ? Film
    : fileType.startsWith('audio/')
      ? Music
      : fileType.startsWith('image/')
        ? ImageIcon
        : FileIcon
  return <Icon className="h-[15px] w-[15px]" />
}

type FilterTab = 'all' | 'active' | 'complete' | 'failed'

function isActiveStatus(status: UploadStatus): boolean {
  return status === 'pending' || status === 'uploading' || status === 'processing'
}

function matchesFilter(status: UploadStatus, filter: FilterTab): boolean {
  switch (filter) {
    case 'all': return true
    case 'active': return isActiveStatus(status)
    case 'complete': return status === 'complete'
    case 'failed': return status === 'failed' || status === 'cancelled'
  }
}

/** Short plain-text status; percentages in mono via the caller. */
function statusText(upload: UploadFile): string {
  switch (upload.status) {
    case 'pending': return 'Queued'
    case 'uploading': return `Uploading ${upload.progress}%`
    case 'processing':
      return upload.processingProgress > 0 ? `Processing ${upload.processingProgress}%` : 'Processing'
    case 'complete': return formatRelativeTime(new Date(upload.createdAt).toISOString())
    case 'failed': return upload.error || 'Failed'
    case 'cancelled': return 'Cancelled'
  }
}

const iconButton =
  'flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary'

function UploadItem({ upload }: { upload: UploadFile }) {
  const { cancelUpload, removeFile } = useUploadStore()
  const [linkCopied, setLinkCopied] = React.useState(false)
  const isUploading = upload.status === 'pending' || upload.status === 'uploading'
  const isProcessing = upload.status === 'processing'
  const canCopyAssetLink =
    Boolean(upload.assetId) &&
    (upload.status === 'processing' || upload.status === 'complete')

  const copyAssetLink = React.useCallback(async () => {
    if (!upload.assetId) return

    try {
      await navigator.clipboard.writeText(`${window.location.origin}/assets/${upload.assetId}`)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch (err) {
      if (err instanceof Error) return
      throw err
    }
  }, [upload.assetId])

  return (
    <div className="group flex items-center gap-2.5 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-bg-tertiary text-text-tertiary">
        <FileTypeIcon fileType={upload.fileType} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-text-primary">{upload.assetName}</p>
        <p className="flex gap-1.5 truncate text-[12px] text-text-tertiary">
          <span className="truncate">{upload.projectName || upload.projectId.slice(0, 8)}</span>
          <span className="font-mono">{formatBytes(upload.fileSize)}</span>
          <span
            className={cn(
              'truncate',
              upload.status === 'failed' && 'text-status-error',
              isProcessing && 'text-amber-400',
              upload.status === 'uploading' && 'font-mono text-text-secondary',
            )}
          >
            {statusText(upload)}
          </span>
        </p>
        {(isUploading || (isProcessing && upload.processingProgress > 0)) && (
          <ProgressTrack
            value={getUploadDisplayProgress(upload)}
            warning={isProcessing}
            className="mt-1.5"
          />
        )}
      </div>

      <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 pointer-coarse:opacity-100">
        {canCopyAssetLink && (
          <button
            onClick={() => void copyAssetLink()}
            className={iconButton}
            title={linkCopied ? 'Copied' : 'Copy asset link'}
            aria-label={linkCopied ? 'Copied' : 'Copy asset link'}
          >
            {linkCopied ? <Check className="h-[15px] w-[15px]" /> : <Link className="h-[15px] w-[15px]" />}
          </button>
        )}
        {isUploading ? (
          <button onClick={() => cancelUpload(upload.id)} className={iconButton} title="Cancel upload" aria-label="Cancel upload">
            <X className="h-[15px] w-[15px]" />
          </button>
        ) : !isProcessing ? (
          <button onClick={() => removeFile(upload.id)} className={iconButton} title="Remove" aria-label="Remove">
            <X className="h-[15px] w-[15px]" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function UploadsPanel() {
  const pathname = usePathname()
  const { files, panelOpen, setPanelOpen, clearCompleted, fetchHistory, fetchMoreHistory, historyHasMore, historyLoading } = useUploadStore()
  const [filter, setFilter] = React.useState<FilterTab>('all')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const sentinelRef = React.useRef<HTMLDivElement>(null)

  // Fetch backend history when panel opens
  React.useEffect(() => {
    if (panelOpen) {
      fetchHistory()
    }
  }, [panelOpen, fetchHistory])

  // Infinite scroll — IntersectionObserver on sentinel
  React.useEffect(() => {
    if (!panelOpen) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && historyHasMore && !historyLoading) {
          fetchMoreHistory()
        }
      },
      { root: scrollRef.current, rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [panelOpen, historyHasMore, historyLoading, fetchMoreHistory])

  if (!panelOpen) return null

  const hideQuickShareUploads = pathname === '/'
  const visibleFiles = hideQuickShareUploads
    ? files.filter((file) => !isQuickShareUpload(file))
    : files
  const hiddenQuickShareFiles = hideQuickShareUploads
    ? files.filter((file) => isQuickShareUpload(file))
    : []
  const hasHiddenQuickShareUpload = hiddenQuickShareFiles.some(
    (file) => file.status !== 'failed' && file.status !== 'cancelled',
  )
  const hasVisibleActiveUpload = visibleFiles.some((file) => isActiveStatus(file.status))

  if (hasHiddenQuickShareUpload && !hasVisibleActiveUpload) return null

  // Sort descending by createdAt
  const sorted = [...visibleFiles].sort((a, b) => b.createdAt - a.createdAt)
  const filtered = sorted.filter((f) => matchesFilter(f.status, filter))

  const counts = {
    all: visibleFiles.length,
    active: visibleFiles.filter((f) => isActiveStatus(f.status)).length,
    complete: visibleFiles.filter((f) => f.status === 'complete').length,
    failed: visibleFiles.filter((f) => f.status === 'failed' || f.status === 'cancelled').length,
  }

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'complete', label: 'Done', count: counts.complete },
    { id: 'failed', label: 'Failed', count: counts.failed },
  ]

  // Dim scrim is a single shared element in the header (covers both popovers);
  // this panel just unmounts on close, so switching never ghosts.
  return (
    <div className="fixed right-2 top-14 z-50 flex max-h-[min(70dvh,560px)] w-[380px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md border border-border-strong bg-bg-elevated shadow-xl">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
        <h2 className="text-[13px] font-medium text-text-primary">Uploads</h2>
        {counts.active > 0 && (
          <span className="font-mono text-[12px] text-text-tertiary">{counts.active} active</span>
        )}
        <div className="flex-1" />
        {counts.complete > 0 && (
          <button
            onClick={clearCompleted}
            className="h-7 rounded-md px-2 text-[12.5px] text-text-secondary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
          >
            Clear completed
          </button>
        )}
        <button onClick={() => setPanelOpen(false)} className={iconButton} aria-label="Close uploads">
          <X className="h-[15px] w-[15px]" />
        </button>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-border px-3 text-[12.5px]" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            className={cn(
              'h-full transition-colors duration-100',
              filter === tab.id
                ? 'text-text-primary shadow-[inset_0_-1.5px_0_currentColor]'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {tab.label}
            {tab.count > 0 && <span className="ml-1 font-mono text-[11.5px] text-text-tertiary">{tab.count}</span>}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !historyLoading ? (
          <p className="px-3 py-3 text-[13px] text-text-tertiary">
            {filter === 'all' ? 'No uploads yet.' : 'Nothing here.'}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((upload) => (
              <UploadItem key={upload.id} upload={upload} />
            ))}
          </div>
        )}
        {/* Sentinel for infinite scroll */}
        <div ref={sentinelRef} className="h-1" />
        {historyLoading && <p className="px-3 pb-3 text-[13px] text-text-tertiary">Loading…</p>}
      </div>
    </div>
  )
}
