'use client'

import * as React from 'react'
import {
  Folder,
  File,
  Download,
  Search,
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  Video,
  Music,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  ArrowLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { clearTokens } from '@/lib/auth'
import { useAuthStore } from '@/stores/auth-store'
import { useBrandingStore } from '@/stores/branding-store'
import { VersionSwitcher } from '@/components/review/version-switcher'
import { Linkified } from '@/components/review/linkified'
import { fetchShareStreamInfo, resolveStreamUrl } from './share-stream'
import type {
  SharePermission,
  ShareLinkAppearance,
  FolderShareAssetsResponse,
  FolderShareAssetItem,
  FolderShareSubfolder,
} from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type UseReviewHook = typeof import('@/components/review/review-provider').useReview
type UseReviewStoreHook = typeof import('@/stores/review-store').useReviewStore

// ─── Types ────────────────────────────────────────────────────────────────────

interface FolderShareViewerProps {
  token: string
  shareSession?: string | null
  folderName: string
  title: string
  description: string | null
  createdByName?: string | null
  viewerName?: string | null
  permission: SharePermission
  allowDownload: boolean
  showVersions: boolean
  appearance: ShareLinkAppearance
  branding: {
    logo_url?: string
    primary_color?: string
    custom_title?: string
    custom_footer?: string
  } | null
  onAssetClick?: (assetId: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getAssetTypeIcon(assetType: string): React.ElementType {
  switch (assetType) {
    case 'video': return Video
    case 'audio': return Music
    case 'image':
    case 'image_carousel': return ImageIcon
    default: return File
  }
}

function getAssetTypeBadgeLabel(assetType: string): string {
  switch (assetType) {
    case 'image_carousel': return 'Carousel'
    default: return assetType.charAt(0).toUpperCase() + assetType.slice(1)
  }
}

// ─── Download handler ─────────────────────────────────────────────────────────

function triggerDownload(url: string) {
  // Let the server's Content-Disposition filename win — don't set `a.download`,
  // since it would strip the extension the backend appended.
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => a.remove(), 1000)
}

async function fetchDownloadUrl(token: string, assetId: string, shareSession?: string | null): Promise<string | null> {
  const sp = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''
  try {
    const response = await fetch(`${API_URL}/share/${token}/stream/${assetId}?download=true${sp}`, {
      credentials: 'include',
    })
    if (!response.ok) return null
    const data = await response.json()
    return data?.url ?? null
  } catch {
    return null
  }
}

async function handleDownload(token: string, assetId: string, shareSession?: string | null) {
  const url = await fetchDownloadUrl(token, assetId, shareSession)
  if (url) triggerDownload(url)
}

async function collectAllAssetsRecursive(
  token: string,
  folderId: string | null,
  shareSession?: string | null,
): Promise<{ id: string; name: string }[]> {
  // Fetch assets + subfolders at this level, then recurse into subfolders.
  const sp = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''
  const folderParam = folderId ? `folder_id=${folderId}&` : ''
  try {
    const res = await fetch(`${API_URL}/share/${token}/assets?${folderParam}page=1&per_page=500${sp}`, {
      credentials: 'include',
    })
    if (!res.ok) return []
    const data = await res.json() as { assets?: { id: string; name: string }[]; subfolders?: { id: string }[] }
    const items: { id: string; name: string }[] = (data.assets ?? []).map((a) => ({ id: a.id, name: a.name }))
    const subfolders = data.subfolders ?? []
    for (const sub of subfolders) {
      const nested = await collectAllAssetsRecursive(token, sub.id, shareSession)
      items.push(...nested)
    }
    return items
  } catch {
    return []
  }
}

async function handleDownloadAll(
  token: string,
  folderId: string | null,
  shareSession?: string | null,
) {
  // Recursively collect all assets (including those in subfolders),
  // pre-fetch presigned URLs in parallel, then trigger downloads
  // sequentially with a delay so the browser doesn't block them.
  const allAssets = await collectAllAssetsRecursive(token, folderId, shareSession)
  const urls = await Promise.all(
    allAssets.map((a) => fetchDownloadUrl(token, a.id, shareSession)),
  )
  for (const url of urls) {
    if (!url) continue
    triggerDownload(url)
    await new Promise((r) => setTimeout(r, 800))
  }
}

// ─── Subfolder Card ───────────────────────────────────────────────────────────

interface SubfolderCardProps {
  subfolder: FolderShareSubfolder
  onClick: (subfolder: FolderShareSubfolder) => void
}

function SubfolderCard({ subfolder, onClick }: SubfolderCardProps) {
  const thumbs = subfolder.thumbnail_urls ?? []

  return (
    <button
      className="group flex flex-col rounded-lg border border-border bg-bg-tertiary overflow-hidden text-left transition-all cursor-pointer hover:border-border-focus hover:bg-bg-hover"
      onClick={() => onClick(subfolder)}
    >
      {/* Thumbnail area */}
      <div className="w-full aspect-[16/10] relative overflow-hidden bg-bg-tertiary">
        {thumbs.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Folder className="h-10 w-10 text-text-tertiary" />
          </div>
        ) : thumbs.length === 1 ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumbs[0]}
            alt={subfolder.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className={cn(
            'absolute inset-0 grid gap-[1px]',
            thumbs.length === 2 && 'grid-cols-2',
            thumbs.length >= 3 && 'grid-cols-2 grid-rows-2',
          )}>
            {thumbs.slice(0, 4).map((url, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={i}
                src={url}
                alt=""
                className={cn(
                  'h-full w-full object-cover',
                  thumbs.length === 3 && i === 0 && 'row-span-2',
                )}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-sm font-medium text-text-primary truncate">{subfolder.name}</p>
        <p className="text-xs text-text-tertiary mt-0.5">
          {subfolder.item_count} {subfolder.item_count === 1 ? 'Item' : 'Items'}
        </p>
      </div>
    </button>
  )
}

// ─── List row thumbnail with error fallback ───────────────────────────────────

function ListRowThumb({ asset, TypeIcon }: { asset: FolderShareAssetItem; TypeIcon: React.ElementType }) {
  const [imgError, setImgError] = React.useState(false)
  return (
    <div className="h-14 w-14 shrink-0 rounded-md overflow-hidden bg-bg-tertiary flex items-center justify-center">
      {asset.thumbnail_url && !imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.thumbnail_url} alt={asset.name} className="h-full w-full object-cover" onError={() => setImgError(true)} />
      ) : (
        <TypeIcon className="h-6 w-6 text-text-tertiary/60" />
      )}
    </div>
  )
}

// ─── Asset Grid Card (Frame.io style) ────────────────────────────────────────

interface AssetGridCardProps {
  asset: FolderShareAssetItem
  allowDownload: boolean
  token: string
  shareSession?: string | null
  isSelected: boolean
  onSelect: (asset: FolderShareAssetItem) => void
  onOpen: (asset: FolderShareAssetItem) => void
  aspectClass?: string
  thumbnailScale?: 'fit' | 'fill'
  showCardInfo?: boolean
}

function AssetGridCard({ asset, allowDownload, token, shareSession, isSelected, onSelect, onOpen, aspectClass = 'aspect-[16/10]', thumbnailScale = 'fill', showCardInfo = true }: AssetGridCardProps) {
  const TypeIcon = getAssetTypeIcon(asset.asset_type)
  const [imgError, setImgError] = React.useState(false)

  return (
    <div
      className={cn(
        'group flex flex-col rounded-lg border overflow-hidden transition-all cursor-pointer',
        isSelected
          ? 'border-accent/60 ring-1 ring-accent/40'
          : 'border-border hover:border-border-focus',
        'bg-bg-tertiary hover:bg-bg-hover',
      )}
      onClick={() => onSelect(asset)}
      onDoubleClick={() => onOpen(asset)}
    >
      {/* Thumbnail */}
      <div className={cn('w-full relative overflow-hidden bg-bg-tertiary', aspectClass)}>
        {asset.thumbnail_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnail_url}
            alt={asset.name}
            className={cn('h-full w-full transition-transform duration-200 group-hover:scale-[1.02]', thumbnailScale === 'fill' ? 'object-cover' : 'object-contain')}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-hover text-text-secondary">
              <TypeIcon className="h-7 w-7" />
            </div>
          </div>
        )}

        {/* Comment count badge — bottom left */}
        {asset.comment_count > 0 && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-bg-primary/80 backdrop-blur-sm rounded-md px-1.5 py-0.5">
            <MessageSquare className="h-3 w-3 text-text-primary" />
            <span className="text-[10px] font-medium text-text-primary">{asset.comment_count}</span>
          </div>
        )}

        {/* Duration badge — bottom right (video/audio) */}
        {asset.duration_seconds != null && asset.duration_seconds > 0 && (
          <div className="absolute bottom-2 right-2 bg-bg-primary/80 backdrop-blur-sm rounded-md px-1.5 py-0.5">
            <span className="text-[10px] font-medium text-text-primary tabular-nums">
              {formatDuration(asset.duration_seconds)}
            </span>
          </div>
        )}

        {/* Download button overlay */}
        {allowDownload && (
          <button
            className="absolute top-2 right-2 flex items-center justify-center h-6 w-6 rounded-md bg-bg-primary/70 hover:bg-bg-primary/90 text-text-primary backdrop-blur-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              handleDownload(token, asset.id, shareSession)
            }}
            title="Download"
          >
            <Download className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Info — name, author, date */}
      {showCardInfo && (
        <div className="px-3 py-2.5">
          <p className="text-sm font-medium text-text-primary line-clamp-1">{asset.name}</p>
          <p className="text-xs text-text-tertiary mt-0.5 truncate">
            {asset.created_by_name && <>{asset.created_by_name} &middot; </>}
            {formatShortDate(asset.created_at)}
            {asset.file_size != null && <> &middot; {formatFileSize(asset.file_size)}</>}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Section Header ──────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label: string
  count: number
  totalSize: string | null
  expanded: boolean
  onToggle: () => void
}

function SectionHeader({ label, count, totalSize, expanded, onToggle }: SectionHeaderProps) {
  return (
    <button className="flex items-center gap-2 py-2 w-full text-left group" onClick={onToggle}>
      <ChevronDown
        className={cn('h-4 w-4 shrink-0 transition-transform text-text-tertiary', !expanded && '-rotate-90')}
      />
      <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
        {count} {label}
      </span>
      {totalSize && (
        <span className="text-xs text-text-tertiary">&middot; {totalSize}</span>
      )}
    </button>
  )
}

// ─── Right Panel: Asset Details + Comments ───────────────────────────────────

interface RightPanelProps {
  selectedAsset: FolderShareAssetItem | null
  token: string
  permission: SharePermission
  allowDownload: boolean
  onOpenAsset?: (asset: FolderShareAssetItem) => void
}

interface GuestComment {
  id: string
  body: string
  guest_name: string
  author_name?: string
  author?: { id: string; name: string; avatar_url?: string | null } | null
  guest_author?: { id: string; name: string } | null
  created_at: string
  timecode_start?: number | null
  replies?: GuestComment[]
}

function RightPanel({ selectedAsset, token, permission, allowDownload, onOpenAsset }: RightPanelProps) {
  const [comments, setComments] = React.useState<GuestComment[]>([])
  const [loadingComments, setLoadingComments] = React.useState(false)
  const [commentRefresh, setCommentRefresh] = React.useState(0)
  const canComment = permission === 'comment' || permission === 'approve'

  React.useEffect(() => {
    if (!selectedAsset) {
      setComments([])
      return
    }
    setLoadingComments(true)
    fetch(`${API_URL}/share/${token}/comments?asset_id=${selectedAsset.id}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((data) => setComments(Array.isArray(data) ? data : (data.comments ?? [])))
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false))
  }, [selectedAsset?.id, token, commentRefresh])

  if (!selectedAsset) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="h-14 w-14 rounded-full bg-bg-tertiary flex items-center justify-center mb-3">
          <MessageSquare className="h-7 w-7 text-text-tertiary" />
        </div>
        <p className="text-sm font-medium text-text-primary">Select an asset to view comments</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Asset name header — minimal */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-text-primary truncate">{selectedAsset.name}</h3>
      </div>

      {/* Comments section */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
            Comments ({comments.length})
          </h4>
        </div>
        <ShareCommentList comments={comments} loading={loadingComments} canComment={canComment} />
      </div>

      {/* Comment input — only in asset viewer, not in folder preview */}
    </div>
  )
}

// ─── Share Comment List (matches project review panel style) ─────────────────

const AVATAR_COLORS = [
  'bg-purple-500', 'bg-blue-500', 'bg-green-500', 'bg-orange-500',
  'bg-pink-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-rose-500',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

interface ShareCommentListProps {
  comments: GuestComment[]
  loading: boolean
  canComment: boolean
  onReply?: (commentId: string) => void
}

function ShareCommentList({ comments, loading, canComment, onReply }: ShareCommentListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <MessageSquare className="h-8 w-8 text-text-tertiary mb-2" />
        <p className="text-sm font-medium text-text-primary">No comments yet</p>
        {canComment && <p className="text-xs text-text-tertiary mt-1">Be the first to leave feedback</p>}
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-1">
      {comments.map((comment, i) => {
        const name = comment.author?.name || comment.guest_author?.name || comment.guest_name || comment.author_name || 'User'
        const color = getAvatarColor(name)
        return (
          <div key={comment.id} className="py-3 border-b border-border last:border-0">
            {/* Comment header */}
            <div className="flex items-start gap-3">
              <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-text-primary shrink-0', color)}>
                {name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{name}</span>
                  <span className="text-2xs text-text-tertiary">{formatShortDate(comment.created_at)}</span>
                  <span className="ml-auto text-2xs text-text-tertiary">#{i + 1}</span>
                </div>
                <p className="text-sm text-text-secondary mt-1 leading-relaxed"><Linkified text={comment.body} /></p>
                {comment.timecode_start != null && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-accent font-mono bg-accent/10 px-1.5 py-0.5 rounded">
                    {Math.floor(comment.timecode_start / 60)}:{String(Math.floor(comment.timecode_start % 60)).padStart(2, '0')}
                  </span>
                )}
                {canComment && onReply && (
                  <button onClick={() => onReply(comment.id)} className="block mt-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors">
                    Reply
                  </button>
                )}
              </div>
            </div>

            {/* Nested replies */}
            {comment.replies && comment.replies.length > 0 && (
              <div className="ml-11 mt-2 space-y-2 border-l-2 border-border pl-3">
                {comment.replies.map((r) => {
                  const rName = r.author?.name || r.guest_author?.name || r.guest_name || r.author_name || 'User'
                  const rColor = getAvatarColor(rName)
                  return (
                    <div key={r.id} className="flex items-start gap-2.5 py-1">
                      <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-text-primary shrink-0', rColor)}>
                        {rName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-text-primary">{rName}</span>
                          <span className="text-2xs text-text-tertiary">{formatShortDate(r.created_at)}</span>
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5"><Linkified text={r.body} /></p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Asset Viewer (full-screen media viewer for shared assets) ───────────────

interface AssetViewerProps {
  token: string
  shareSession?: string | null
  asset: FolderShareAssetItem
  viewerName?: string | null
  permission: SharePermission
  allowDownload: boolean
  onBack: () => void
}

function AssetViewer({ token, shareSession, asset, viewerName, permission, allowDownload, onBack }: AssetViewerProps) {
  // Use the same ReviewProvider as the project review page, but with shareToken
  // This gives us the same video player, image viewer, comment panel, etc.
  return (
    <div className="fixed inset-0 z-50">
      <ShareReviewScreen
        token={token}
        shareSession={shareSession}
        assetId={asset.id}
        assetName={asset.name}
        viewerName={viewerName}
        permission={permission}
        allowDownload={allowDownload}
        onBack={onBack}
      />
    </div>
  )
}

/** Lazy-imported review components to avoid circular deps */
export function ShareReviewScreen({
  token, shareSession, assetId, assetName, viewerName, permission, allowDownload, onBack,
}: {
  token: string; shareSession?: string | null; assetId: string; assetName: string; viewerName?: string | null; permission: SharePermission; allowDownload: boolean; onBack?: () => void
}) {
  const [ReviewProvider, setProvider] = React.useState<any>(null)
  const [VideoPlayer, setVideoPlayer] = React.useState<any>(null)
  const [ImageViewer, setImageViewer] = React.useState<any>(null)
  const [AudioPlayer, setAudioPlayer] = React.useState<any>(null)
  const [CommentPanel, setCommentPanel] = React.useState<any>(null)
  const [CommentInput, setCommentInput] = React.useState<any>(null)
  const [useReviewHook, setUseReviewHook] = React.useState<UseReviewHook | null>(null)
  const [useReviewStoreHook, setUseReviewStoreHook] = React.useState<UseReviewStoreHook | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    // Dynamic import to avoid SSR issues
    Promise.all([
      import('@/components/review/review-provider'),
      import('@/components/review/video-player'),
      import('@/components/review/image-viewer'),
      import('@/components/review/audio-player'),
      import('@/components/review/comment-panel'),
      import('@/components/review/comment-input'),
      import('@/stores/review-store'),
    ]).then(([provider, video, image, audio, comments, input, reviewStore]) => {
      setProvider(() => provider.ReviewProvider)
      setVideoPlayer(() => video.VideoPlayer)
      setImageViewer(() => image.ImageViewer)
      setAudioPlayer(() => audio.AudioPlayer)
      setCommentPanel(() => comments.CommentPanel)
      setCommentInput(() => input.CommentInput)
      setUseReviewHook(() => provider.useReview)
      setUseReviewStoreHook(() => reviewStore.useReviewStore)
      setLoaded(true)
    })
  }, [])

  if (!loaded || !ReviewProvider || !useReviewHook || !useReviewStoreHook) {
    return <div className="flex items-center justify-center h-dvh bg-bg-primary"><Loader2 className="h-8 w-8 animate-spin text-text-tertiary" /></div>
  }

  return (
    <ReviewProvider assetId={assetId} shareToken={token} shareSession={shareSession}>
      <ShareReviewInner
        token={token}
        shareSession={shareSession}
        assetName={assetName}
        viewerName={viewerName}
        permission={permission}
        allowDownload={allowDownload}
        onBack={onBack}
        VideoPlayer={VideoPlayer}
        ImageViewer={ImageViewer}
        AudioPlayer={AudioPlayer}
        CommentPanel={CommentPanel}
        CommentInput={CommentInput}
        useReviewHook={useReviewHook}
        useReviewStoreHook={useReviewStoreHook}
      />
    </ReviewProvider>
  )
}

function ShareReviewInner({
  token, shareSession, assetName, viewerName, permission, allowDownload, onBack,
  VideoPlayer, ImageViewer, AudioPlayer, CommentPanel, CommentInput,
  useReviewHook, useReviewStoreHook,
}: any) {
  const { asset, versions, isLoading, comments, refetchComments, addComment } = useReviewHook()
  const { currentVersion, isDrawingMode, focusedCommentId } = useReviewStoreHook()
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'comments' | 'fields'>('comments')
  const [AnnotationOverlay, setAnnotationOverlay] = React.useState<any>(null)
  const [AnnotationCanvas, setAnnotationCanvas] = React.useState<any>(null)
  const autoOpenedRef = React.useRef(false)

  React.useEffect(() => {
    Promise.all([
      import('@/components/review/annotation-overlay'),
      import('@/components/review/annotation-canvas'),
    ]).then(([overlayMod, canvasMod]) => {
      setAnnotationOverlay(() => overlayMod.AnnotationOverlay)
      setAnnotationCanvas(() => canvasMod.AnnotationCanvas)
    })
  }, [])

  const canComment = permission === 'comment' || permission === 'approve'
  const versionReady = currentVersion?.processing_status === 'ready'
  React.useEffect(() => {
    if (autoOpenedRef.current) return
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches
    if (isDesktop || comments.length > 0) {
      setSidebarOpen(true)
      autoOpenedRef.current = true
    }
  }, [comments.length])

  const assetId = asset?.id
  const assetType = asset?.asset_type
  const [streamInfo, setStreamInfo] = React.useState<{ url: string; poster: string | null } | null>(null)
  React.useEffect(() => {
    if (!assetId || assetType !== 'video' || !versionReady) return
    let cancelled = false
    setStreamInfo(null)
    fetchShareStreamInfo(token, assetId, {
      versionId: currentVersion?.id ?? null,
      shareSession,
    })
      .then((info) => {
        if (!cancelled) {
          setStreamInfo({ url: resolveStreamUrl(info.url), poster: info.thumbnail_url ?? null })
        }
      })
      .catch(() => {
        if (!cancelled) setStreamInfo(null)
      })
    return () => { cancelled = true }
  }, [token, assetId, assetType, currentVersion?.id, shareSession, versionReady])

  // Guest identity flow for non-authenticated users
  const [guestIdentity, setGuestIdentity] = React.useState<{ name: string; email: string } | null>(null)
  const [showGuestPrompt, setShowGuestPrompt] = React.useState(false)
  const pendingCommentRef = React.useRef<{ body: string; timecodeStart?: number; timecodeEnd?: number; annotationData?: Record<string, unknown> } | null>(null)
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('ff_guest_identity')
      if (stored) setGuestIdentity(JSON.parse(stored))
    } catch {}
  }, [])
  const isLoggedIn = Boolean(viewerName)

  // Resolve viewer's user id so own comments get edit/delete controls
  const authUser = useAuthStore((s) => s.user)
  const fetchUser = useAuthStore((s) => s.fetchUser)
  React.useEffect(() => {
    if (isLoggedIn && !authUser) void fetchUser()
  }, [isLoggedIn, authUser, fetchUser])
  const currentUserId = isLoggedIn ? authUser?.id : undefined

  // Own-comment mutations carry the share context — the viewer has no project access
  const mutationQuery = React.useMemo(() => {
    const params = new URLSearchParams({ share_token: token })
    if (shareSession) params.set('share_session', shareSession)
    return params.toString()
  }, [token, shareSession])

  const handleDeleteComment = React.useCallback(async (commentId: string) => {
    const { api } = await import('@/lib/api')
    await api.delete(`/comments/${commentId}?${mutationQuery}`)
    refetchComments().catch(() => {})
  }, [mutationQuery, refetchComments])

  const submitComment = React.useCallback(async (body: string, timecodeStart?: number, timecodeEnd?: number, annotationData?: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { body }
    if (currentVersion?.id) payload.version_id = currentVersion.id
    if (timecodeStart != null) payload.timecode_start = timecodeStart
    if (timecodeEnd != null) payload.timecode_end = timecodeEnd
    if (annotationData) payload.annotation = { drawing_data: annotationData }
    if (isLoggedIn) {
      const shareSessionParam = shareSession
        ? `?share_session=${encodeURIComponent(shareSession)}`
        : ''
      const response = await fetch(`${API_URL}/share/${token}/comment${shareSessionParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, asset_id: assetId }),
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Failed to post comment')
    } else {
      await addComment(payload)
    }
    refetchComments().catch(() => {})
  }, [addComment, assetId, currentVersion, isLoggedIn, refetchComments, shareSession, token])

  const handleGuestIdentitySave = React.useCallback(async (name: string, email: string) => {
    const identity = { name, email }
    setGuestIdentity(identity)
    localStorage.setItem('ff_guest_identity', JSON.stringify(identity))
    setShowGuestPrompt(false)

    // Auto-submit the pending comment
    if (pendingCommentRef.current) {
      const { body, timecodeStart, timecodeEnd, annotationData } = pendingCommentRef.current
      pendingCommentRef.current = null
      setTimeout(() => submitComment(body, timecodeStart, timecodeEnd, annotationData), 50)
    }
  }, [submitComment])

  if (isLoading || !asset) {
    return <div className="flex items-center justify-center h-dvh bg-bg-primary"><Loader2 className="h-8 w-8 animate-spin text-text-tertiary" /></div>
  }

  return (
    <div className="flex flex-col h-dvh bg-bg-primary text-text-primary">
      {/* Top bar — same style as project review */}
      <div className="flex items-center justify-between border-b border-border px-3 h-12 bg-bg-secondary shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {onBack && (
            <button onClick={onBack} className="flex items-center justify-center h-7 w-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="text-[13px] font-medium text-text-primary truncate">{assetName}</span>
        </div>
        <div className="flex items-center gap-2">
          {versions.length > 1 && (
            <VersionSwitcher versions={versions} />
          )}
          {allowDownload && (
            <button className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium text-text-inverse bg-accent hover:bg-accent-hover transition-colors" onClick={() => handleDownload(token, asset.id, shareSession)}>
              <Download className="h-3 w-3" /> Download
            </button>
          )}
          <button onClick={() => setSidebarOpen(v => !v)} className="hidden md:flex items-center justify-center h-8 w-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
            {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main: viewer + sidebar */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        {/* Media viewer — reuses project components */}
        <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
          {asset.asset_type === 'video' && versionReady && VideoPlayer && streamInfo ? (
            <VideoPlayer
              assetId={asset.id}
              key={streamInfo.url}
              comments={comments}
              className="flex-1"
              initialStreamUrl={streamInfo.url}
              poster={streamInfo.poster}
              onDownload={allowDownload ? () => handleDownload(token, asset.id, shareSession) : undefined}
              overlay={
                <>
                  {AnnotationOverlay && <AnnotationOverlay key={focusedCommentId ?? 'none'} />}
                  {isDrawingMode && AnnotationCanvas && <AnnotationCanvas />}
                </>
              }
            />
          ) : asset.asset_type === 'audio' && versionReady && AudioPlayer ? (
            <AudioPlayer asset={asset} version={currentVersion} comments={comments} className="flex-1" />
          ) : (asset.asset_type === 'image' || asset.asset_type === 'image_carousel') && versionReady && ImageViewer ? (
            <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
              <ImageViewer
                asset={asset}
                version={currentVersion}
                annotationCanvas={
                  <>
                    {AnnotationOverlay && <AnnotationOverlay key={focusedCommentId ?? 'none'} />}
                    {isDrawingMode && AnnotationCanvas && <AnnotationCanvas />}
                  </>
                }
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
            </div>
          )}
        </div>

        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden flex items-center justify-center gap-1.5 w-full py-2.5 text-xs font-medium text-text-secondary border-t border-border bg-bg-secondary shrink-0"
          >
            <MessageSquare className="h-4 w-4" />
            Show comments{comments.length > 0 ? ` (${comments.length})` : ''}
          </button>
        )}

        {/* Right sidebar — reuses project comment panel */}
        {sidebarOpen && (
          <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"
            >
              <ChevronDown className="h-4 w-4" />
              Hide comments
            </button>
            <div className="px-4 pt-3 pb-2 shrink-0">
              <div className="flex items-center bg-bg-tertiary rounded-lg p-0.5">
                <button onClick={() => setActiveTab('comments')} className={`flex-1 py-1.5 text-[13px] font-medium rounded-md transition-all ${activeTab === 'comments' ? 'bg-bg-hover text-text-primary shadow-sm' : 'text-text-tertiary'}`}>
                  Comments
                </button>
                <button onClick={() => setActiveTab('fields')} className={`flex-1 py-1.5 text-[13px] font-medium rounded-md transition-all ${activeTab === 'fields' ? 'bg-bg-hover text-text-primary shadow-sm' : 'text-text-tertiary'}`}>
                  Fields
                </button>
              </div>
            </div>

            {activeTab === 'comments' && CommentPanel && (
              <>
                <CommentPanel
                  comments={comments}
                  currentUserId={currentUserId}
                  mutationQuery={mutationQuery}
                  onDelete={handleDeleteComment}
                  onAddReaction={() => {}}
                  onRemoveReaction={() => {}}
                  onReply={() => {}}
                  onSubmitReply={async () => {}}
                />
                {canComment && CommentInput && (
                  <CommentInput
                    assetId={asset.id}
                    projectId=""
                    assetType={asset.asset_type}
                    visibilityLocked
                    onSubmit={async (body: string, timecodeStart?: number, timecodeEnd?: number, annotationData?: Record<string, unknown>) => {
                      const hasIdentity = isLoggedIn || Boolean(localStorage.getItem('ff_guest_identity'))
                      if (!hasIdentity) {
                        pendingCommentRef.current = { body, timecodeStart, timecodeEnd, annotationData }
                        setShowGuestPrompt(true)
                        return
                      }
                      await submitComment(body, timecodeStart, timecodeEnd, annotationData)
                    }}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Guest identity prompt */}
      {showGuestPrompt && !isLoggedIn && (
        <GuestIdentityPrompt
          onSave={handleGuestIdentitySave}
          onCancel={() => { setShowGuestPrompt(false); pendingCommentRef.current = null }}
        />
      )}
    </div>
  )
}

// ─── Guest Identity Prompt ───────────────────────────────────────────────────

function GuestIdentityPrompt({ onSave, onCancel }: { onSave: (name: string, email: string) => void; onCancel: () => void }) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded border border-border bg-bg-elevated p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Leave a comment</h3>
        <p className="text-xs text-text-tertiary mb-4">Enter your name and email to comment on this shared asset.</p>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
            autoFocus
          />
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors">
            Cancel
          </button>
          <button
            disabled={!name.trim() || !email.trim()}
            onClick={() => onSave(name.trim(), email.trim())}
            className="px-4 py-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FolderShareViewer({
  token,
  shareSession,
  folderName,
  title,
  description,
  createdByName,
  viewerName,
  permission,
  allowDownload,
  showVersions: _showVersions,
  appearance,
  branding,
  onAssetClick,
}: FolderShareViewerProps) {
  // Build share_session query param for all API calls
  const sessionParam = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''
  const [currentSubfolderId, setCurrentSubfolderId] = React.useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = React.useState<{ id: string; name: string }[]>([])
  const [searchQuery, setSearchQuery] = React.useState('')
  const [foldersExpanded, setFoldersExpanded] = React.useState(true)
  const [assetsExpanded, setAssetsExpanded] = React.useState(true)
  const [panelOpen, setPanelOpen] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  )
  const [viewingAsset, setViewingAsset] = React.useState<FolderShareAssetItem | null>(null)
  const [isTouch, setIsTouch] = React.useState(false)
  const [viewerMenuOpen, setViewerMenuOpen] = React.useState(false)
  const viewerMenuRef = React.useRef<HTMLDivElement>(null)

  // Set page title
  const orgName = useBrandingStore((s) => s.orgName)
  React.useEffect(() => {
    document.title = title ? `${title} – ${orgName}` : orgName
    return () => { document.title = 'FreeFrame' }
  }, [title, orgName])
  React.useEffect(() => {
    setIsTouch(window.matchMedia('(hover: none)').matches)
  }, [])
  React.useEffect(() => {
    if (!viewerMenuOpen) return
    function handleClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (viewerMenuRef.current && !viewerMenuRef.current.contains(target)) {
        setViewerMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [viewerMenuOpen])
  const [selectedAsset, setSelectedAsset] = React.useState<FolderShareAssetItem | null>(null)

  const [assets, setAssets] = React.useState<FolderShareAssetItem[]>([])
  const [subfolders, setSubfolders] = React.useState<FolderShareSubfolder[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const accentColor = appearance.accent_color ?? branding?.primary_color
  const isDark = appearance.theme !== 'light'
  const cardSize = appearance.card_size ?? 'm'
  const aspectRatio = appearance.aspect_ratio ?? 'landscape'
  const thumbnailScale = appearance.thumbnail_scale ?? 'fill'
  const showCardInfo = appearance.show_card_info !== false
  const isGridLayout = appearance.layout !== 'list'
  const perPage = 24

  // Grid column classes based on card_size
  const gridCols = cardSize === 's'
    ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7'
    : cardSize === 'l'
    ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'

  // Aspect ratio class
  const aspectClass = aspectRatio === 'square'
    ? 'aspect-square'
    : aspectRatio === 'portrait'
    ? 'aspect-[3/4]'
    : 'aspect-[16/10]'

  // Apply share link theme (overrides user's global theme on the share page)
  React.useEffect(() => {
    const theme = isDark ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    return () => {
      // Restore user's theme when leaving share page
      try {
        const stored = JSON.parse(localStorage.getItem('ff-theme') || '{}')
        const userTheme = stored?.state?.theme || 'dark'
        const resolved = userTheme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : userTheme
        document.documentElement.setAttribute('data-theme', resolved)
      } catch {
        document.documentElement.setAttribute('data-theme', 'dark')
      }
    }
  }, [isDark])

  React.useEffect(() => {
    const styleId = 'ff-share-accent'
    if (!accentColor) {
      document.getElementById(styleId)?.remove()
      return
    }
    let el = document.getElementById(styleId) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = styleId
      document.head.appendChild(el)
    }
    el.textContent = `:root { --accent: ${accentColor} !important; }`
    return () => {
      document.getElementById(styleId)?.remove()
    }
  }, [accentColor])

  // Whether clicking opens viewer
  const openInViewer = appearance.open_in_viewer !== false

  // Compute total size of assets
  const totalAssetSize = React.useMemo(() => {
    const sum = assets.reduce((acc, a) => acc + (a.file_size ?? 0), 0)
    return sum > 0 ? formatFileSize(sum) : null
  }, [assets])

  // Compute total size of subfolders (approximate from asset sizes)
  const totalFolderSize = React.useMemo(() => {
    // We don't have individual subfolder sizes from the API,
    // just show item count info instead
    return null
  }, [])

  // Fetch assets for current folder/page
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPage(1)
    setAssets([])
    setSubfolders([])
    setSelectedAsset(null)

    fetch(
      `${API_URL}/share/${token}/assets?${currentSubfolderId ? `folder_id=${currentSubfolderId}&` : ''}page=1&per_page=${perPage}${sessionParam}`,
      { credentials: 'include' },
    )
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load assets')
        return r.json() as Promise<FolderShareAssetsResponse>
      })
      .then((data) => {
        if (cancelled) return
        setAssets(data.assets ?? [])
        setSubfolders(data.subfolders ?? [])
        setTotal(data.total ?? 0)
        setPage(1)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load contents')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [token, currentSubfolderId])

  async function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const r = await fetch(
        `${API_URL}/share/${token}/assets?${currentSubfolderId ? `folder_id=${currentSubfolderId}&` : ''}page=${nextPage}&per_page=${perPage}${sessionParam}`,
        { credentials: 'include' },
      )
      if (!r.ok) throw new Error('Failed to load more')
      const data = (await r.json()) as FolderShareAssetsResponse
      setAssets((prev) => [...prev, ...(data.assets ?? [])])
      setPage(nextPage)
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false)
    }
  }

  function navigateToSubfolder(subfolder: FolderShareSubfolder) {
    setBreadcrumbs((prev) => [...prev, { id: subfolder.id, name: subfolder.name }])
    setCurrentSubfolderId(subfolder.id)
    setSearchQuery('')
  }

  function navigateToBreadcrumb(index: number) {
    if (index === -1) {
      setBreadcrumbs([])
      setCurrentSubfolderId(null)
    } else {
      const crumb = breadcrumbs[index]
      setBreadcrumbs((prev) => prev.slice(0, index + 1))
      setCurrentSubfolderId(crumb.id)
    }
    setSearchQuery('')
  }

  // Client-side search filter + sort
  const sortBy = appearance.sort_by ?? 'created_at'
  const filteredAssets = React.useMemo(() => {
    const list = searchQuery.trim()
      ? assets.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
      : [...assets]
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'file_size') return (b.file_size ?? 0) - (a.file_size ?? 0)
      // default: created_at desc
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    return list
  }, [assets, searchQuery, sortBy])

  const filteredSubfolders = searchQuery.trim()
    ? subfolders.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    : subfolders

  const hasMore = assets.length < total && !searchQuery.trim()

  // Summary text
  const summaryParts: string[] = []
  if (subfolders.length > 0) {
    summaryParts.push(`${subfolders.length} Folder${subfolders.length === 1 ? '' : 's'}`)
  }
  if (assets.length > 0) {
    summaryParts.push(`${assets.length} Asset${assets.length === 1 ? '' : 's'}`)
  }
  const summaryText = summaryParts.join(', ')

  // Current folder name for breadcrumb display
  const currentTitle = breadcrumbs.length > 0
    ? breadcrumbs[breadcrumbs.length - 1].name
    : (title || folderName)

  // Asset viewer overlay
  if (viewingAsset) {
    return (
      <AssetViewer
        token={token}
        shareSession={shareSession}
        asset={viewingAsset}
        viewerName={viewerName}
        permission={permission}
        allowDownload={allowDownload}
        onBack={() => setViewingAsset(null)}
      />
    )
  }

  return (
    <div className="flex-1 min-h-screen flex flex-col bg-bg-primary text-text-primary">
      {/* ─── Top Bar (Frame.io style) ─────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-border px-4 h-12 bg-bg-secondary shrink-0">
        {/* Left: viewer profile + breadcrumb */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Viewer avatar (logged-in user) or project avatar */}
          {viewerName ? (
            <div ref={viewerMenuRef} className="relative group shrink-0">
              <button
                onClick={() => setViewerMenuOpen((v) => !v)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-text-primary bg-green-600 hover:ring-2 hover:ring-green-400/50 transition-all"
              >
                {viewerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </button>
              {/* Dropdown */}
              <div className={cn(
                'absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-bg-elevated py-1',
                viewerMenuOpen ? 'block' : 'hidden md:group-hover:block',
              )}>
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-sm font-medium text-text-primary">{viewerName}</p>
                </div>
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.location.href = '/projects'
                    }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  Back to Dashboard
                </button>
                <button
                  onClick={() => {
                    clearTokens()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Log out
                </button>
              </div>
            </div>
          ) : branding?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logo_url}
              alt=""
              className="h-7 w-7 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <span className="font-mono text-[15px] font-bold text-text-primary">
                freeframed
              </span>
            </div>
          )}

          {/* Breadcrumb */}
          <span className="text-[13px] font-medium text-text-primary truncate">{currentTitle}</span>
        </div>

        {/* Right: Download All + panel toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {allowDownload && (
            <button
              className="flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium text-white bg-accent hover:bg-accent-hover transition-colors"
              onClick={() => handleDownloadAll(token, currentSubfolderId ?? null, shareSession)}
            >
              <Download className="h-3 w-3" />
              Download All
            </button>
          )}
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="flex items-center justify-center h-7 w-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={panelOpen ? 'Hide panel' : 'Show panel'}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* ─── Content area ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* ─── Left: folder contents ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Sub-header: title, summary, breadcrumb, search */}
          <div className="border-b border-border px-5 py-4">
            <h1 className="text-lg font-bold text-text-primary leading-tight">{title || folderName}</h1>
            {!loading && (
              <p className="mt-0.5 text-sm text-text-tertiary">
                {createdByName && <>Created by {createdByName} &middot; </>}
                {summaryText || 'Empty folder'}
              </p>
            )}

            {/* Breadcrumb + Search row */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
                <button
                  className={cn(
                    'shrink-0 font-medium hover:underline text-text-secondary hover:text-text-primary',
                    breadcrumbs.length === 0 && 'text-text-primary pointer-events-none',
                  )}
                  onClick={() => navigateToBreadcrumb(-1)}
                >
                  Root
                </button>
                {breadcrumbs.map((crumb, i) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    <button
                      className={cn(
                        'truncate max-w-[160px] hover:underline',
                        i === breadcrumbs.length - 1
                          ? 'text-text-primary font-medium pointer-events-none'
                          : 'text-text-secondary hover:text-text-primary',
                      )}
                      onClick={() => navigateToBreadcrumb(i)}
                      title={crumb.name}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </nav>

              {/* Search */}
              <div className="relative flex items-center grow sm:grow-0">
                <Search className="absolute left-2.5 h-3.5 w-3.5 pointer-events-none text-text-tertiary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search assets…"
                  className="h-8 w-full sm:w-52 pl-8 pr-3 rounded-md text-sm border bg-bg-tertiary border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
                />
              </div>
            </div>
          </div>

          {/* Main scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-24">
                <p className="text-sm text-text-tertiary">{error}</p>
              </div>
            ) : filteredSubfolders.length === 0 && filteredAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <Folder className="h-12 w-12 text-text-tertiary" />
                <p className="text-sm text-text-tertiary">
                  {searchQuery.trim() ? 'No results found' : 'This folder is empty'}
                </p>
              </div>
            ) : (
              <>
                {/* Subfolders section */}
                {filteredSubfolders.length > 0 && (
                  <section className="mb-6">
                    <SectionHeader
                      label={filteredSubfolders.length === 1 ? 'Folder' : 'Folders'}
                      count={filteredSubfolders.length}
                      totalSize={totalFolderSize}
                      expanded={foldersExpanded}
                      onToggle={() => setFoldersExpanded((v) => !v)}
                    />
                    {foldersExpanded && (
                      <div className={cn('grid gap-3 mt-2', gridCols)}>
                        {filteredSubfolders.map((subfolder) => (
                          <SubfolderCard
                            key={subfolder.id}
                            subfolder={subfolder}
                            onClick={navigateToSubfolder}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* Assets section */}
                {filteredAssets.length > 0 && (
                  <section>
                    <SectionHeader
                      label={filteredAssets.length === 1 ? 'Asset' : 'Assets'}
                      count={filteredAssets.length}
                      totalSize={totalAssetSize}
                      expanded={assetsExpanded}
                      onToggle={() => setAssetsExpanded((v) => !v)}
                    />

                    {assetsExpanded && (
                      <>
                        {isGridLayout ? (
                          <div className={cn('grid gap-3 mt-2', gridCols)}>
                            {filteredAssets.map((asset) => (
                              <AssetGridCard
                                key={asset.id}
                                asset={asset}
                                allowDownload={allowDownload}
                                token={token}
                                shareSession={shareSession}
                                isSelected={selectedAsset?.id === asset.id}
                                onSelect={(a) => {
                                  if (isTouch && openInViewer) setViewingAsset(a)
                                  else setSelectedAsset(a)
                                }}
                                onOpen={openInViewer ? setViewingAsset : () => {}}
                                aspectClass={aspectClass}
                                thumbnailScale={thumbnailScale}
                                showCardInfo={showCardInfo}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 rounded-lg border border-border overflow-hidden">
                            {/* Column headers */}
                            <div className="flex items-center gap-4 px-1 py-2 border-b border-border bg-bg-secondary/50 text-[10px] text-text-tertiary font-medium uppercase tracking-wider">
                              <div className="h-14 w-14 shrink-0" />
                              <div className="flex-1 min-w-0">Name</div>
                              <div className="hidden sm:block w-24 text-right shrink-0">Size</div>
                              <div className="hidden sm:block w-28 shrink-0">Date</div>
                              {allowDownload && <div className="w-7 shrink-0" />}
                            </div>
                            {filteredAssets.map((asset, i) => {
                              const TypeIcon = getAssetTypeIcon(asset.asset_type)
                              return (
                                <div
                                  key={asset.id}
                                  className={cn(
                                    'group flex items-center gap-4 py-2 px-1 cursor-pointer transition-colors hover:bg-bg-hover',
                                    selectedAsset?.id === asset.id && 'bg-accent/5',
                                    i !== filteredAssets.length - 1 && 'border-b border-border',
                                  )}
                                  onClick={() => {
                                    if (isTouch && openInViewer) setViewingAsset(asset)
                                    else setSelectedAsset(asset)
                                  }}
                                  onDoubleClick={() => openInViewer && setViewingAsset(asset)}
                                >
                                  {/* Square thumbnail */}
                                  <ListRowThumb asset={asset} TypeIcon={TypeIcon} />
                                  {/* Name + meta */}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text-primary truncate leading-snug">{asset.name}</p>
                                    <p className="text-xs text-text-tertiary mt-0.5 truncate">
                                      {asset.created_by_name && <>{asset.created_by_name} &middot; </>}
                                      {formatShortDate(asset.created_at)}
                                    </p>
                                  </div>
                                  {/* File size */}
                                  <span className="hidden sm:block w-24 text-right text-sm text-text-tertiary tabular-nums shrink-0">
                                    {asset.file_size != null ? formatFileSize(asset.file_size) : '—'}
                                  </span>
                                  {/* Date */}
                                  <span className="hidden sm:block w-28 text-xs text-text-tertiary shrink-0">
                                    {formatDate(asset.created_at)}
                                  </span>
                                  {/* Download */}
                                  {allowDownload && (
                                    <button
                                      className="w-7 shrink-0 flex items-center justify-center h-7 rounded text-text-tertiary opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-text-primary transition-all"
                                      onClick={(e) => { e.stopPropagation(); handleDownload(token, asset.id, shareSession) }}
                                      title="Download"
                                    >
                                      <Download className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Load more */}
                        {hasMore && (
                          <div className="flex justify-center mt-6">
                            <button
                              onClick={loadMore}
                              disabled={loadingMore}
                              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium border border-border text-text-primary hover:bg-bg-tertiary hover:border-border-focus disabled:opacity-50 transition-colors"
                            >
                              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                              {loadingMore ? 'Loading…' : 'Load more'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <footer className="border-t border-border px-5 py-3 shrink-0">
            <div className="flex items-center justify-between">
              {branding?.custom_footer ? (
                <p className="text-xs text-text-tertiary">{branding.custom_footer}</p>
              ) : (
                <span />
              )}
              {!loading && (
                <p className="text-xs tabular-nums text-text-tertiary">
                  {assets.length + subfolders.length} item{assets.length + subfolders.length === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </footer>
        </div>

        {/* ─── Right Panel ───────────────────────────────────────────── */}
        {panelOpen && (
          <div className="w-full h-[55vh] md:h-auto md:w-[320px] shrink-0 border-t md:border-t-0 md:border-l border-border bg-bg-secondary flex flex-col overflow-hidden">
            <RightPanel
              selectedAsset={selectedAsset}
              token={token}
              permission={permission}
              allowDownload={allowDownload}
              onOpenAsset={setViewingAsset}
            />
          </div>
        )}
      </div>
    </div>
  )
}
