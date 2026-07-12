'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { ReviewProvider, useReview } from '@/components/review/review-provider'
import { VideoPlayer } from '@/components/review/video-player'
import { AudioPlayer } from '@/components/review/audio-player'
import { ImageViewer } from '@/components/review/image-viewer'
import { AnnotationCanvas } from '@/components/review/annotation-canvas'
import { AnnotationOverlay } from '@/components/review/annotation-overlay'
import { CommentPanel } from '@/components/review/comment-panel'
import { CommentInput } from '@/components/review/comment-input'
import { ApprovalBar } from '@/components/review/approval-bar'
import { VersionSwitcher } from '@/components/review/version-switcher'
import { ShareDialog } from '@/components/review/share-dialog'
import { useReviewStore } from '@/stores/review-store'
import { useAuthStore } from '@/stores/auth-store'
import { useComments } from '@/hooks/use-comments'
import { api } from '@/lib/api'
import { isFolderDirectProject, resolveFolderPermission } from '@/lib/project-access'
import { useUploadStore } from '@/stores/upload-store'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Loader2,
  Columns2,
  MessageSquare,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import type { ApiError } from '@/lib/api'
import type { AssetResponse, FolderTreeNode, ProjectAccessResponse } from '@/types'

const acceptByType: Record<string, string> = {
  video: 'video/*',
  audio: 'audio/*',
  image: 'image/*',
  image_carousel: 'image/*',
}

function ReviewScreenInner({ projectId }: { projectId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { asset, versions, isLoading, error: reviewError, refetchComments, refetchVersions } = useReview()
  const { currentVersion, isDrawingMode, focusedCommentId, seekTo, setFocusedCommentId, setActiveAnnotation } = useReviewStore()
  const { user } = useAuthStore()
  const startVersionUpload = useUploadStore((s) => s.startVersionUpload)
  const versionFileInputRef = useRef<HTMLInputElement>(null)
  const setExtraCrumbs = useBreadcrumbStore((s) => s.setExtraCrumbs)
  const setLabel = useBreadcrumbStore((s) => s.setLabel)
  usePageTitle(asset?.name ?? null)
  const [annotationData, setAnnotationData] = useState<Record<string, unknown> | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const { data: project, error: projectError } = useSWR<ProjectAccessResponse, ApiError>(
    `/projects/${projectId}`,
    () => api.get<ProjectAccessResponse>(`/projects/${projectId}`),
  )

  async function handleDownload() {
    if (!asset || downloading) return
    setDownloading(true)
    try {
      const res = await api.get<{ url: string }>(`/assets/${asset.id}/stream?download=true`)
      // Let the server's Content-Disposition filename win — don't set `a.download`
      const a = document.createElement('a')
      a.href = res.url
      a.rel = 'noopener noreferrer'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => a.remove(), 1000)
    } catch {
      // presign failed — button simply re-enables
    } finally {
      setDownloading(false)
    }
  }
  const deepLinkApplied = useRef(false)
  const autoOpenedRef = useRef(false)

  // Fetch folder tree to build the folder path for the breadcrumb
  const { data: folderTree } = useSWR<FolderTreeNode[]>(
    asset && project && !reviewError && projectError === undefined
      ? `/projects/${projectId}/folder-tree`
      : null,
    () => api.get<FolderTreeNode[]>(`/projects/${projectId}/folder-tree`),
  )

  // Set extra crumbs = [folder path..., asset name]
  // Don't register asset UUID as a label — use extraCrumbs for correct ordering
  useEffect(() => {
    if (!asset?.name) return

    function findPath(
      nodes: FolderTreeNode[],
      targetId: string,
      trail: { id: string; name: string }[],
    ): { id: string; name: string }[] | null {
      for (const node of nodes) {
        const next = [...trail, { id: node.id, name: node.name }]
        if (node.id === targetId) return next
        const found = findPath(node.children, targetId, next)
        if (found) return found
      }
      return null
    }

    const folderPath = asset.folder_id && folderTree
      ? (findPath(folderTree, asset.folder_id, []) ?? [])
      : []

    setExtraCrumbs([
      ...folderPath.map((f) => ({ label: f.name, href: `/projects/${projectId}?folder=${f.id}` })),
      { label: asset.name }, // asset name — no href (current page)
    ])
  }, [asset?.id, asset?.name, asset?.folder_id, folderTree, setExtraCrumbs])

  useEffect(() => {
    if (project?.name) setLabel(projectId, project.name)
  }, [project?.name, projectId, setLabel])

  const folderDirect = isFolderDirectProject(project)
  const folderPermission = folderDirect && asset?.folder_id
    ? resolveFolderPermission(project.folder_access, asset.folder_id, folderTree ?? [])
    : null
  const currentRole = project?.role ?? 'viewer'
  const canComment = currentRole !== 'viewer' || folderPermission === 'comment' || folderPermission === 'approve'
  const canApprove = folderDirect
    ? folderPermission === 'approve'
    : currentRole === 'owner' || currentRole === 'editor' || currentRole === 'reviewer'

  // Fetch all assets for navigation (1 of N)
  const { data: allAssets } = useSWR<AssetResponse[]>(
    project && !reviewError && projectError === undefined ? `/projects/${projectId}/assets` : null,
    () => api.get<AssetResponse[]>(`/projects/${projectId}/assets`),
  )

  const {
    comments,
    createComment,
    resolveComment,
    deleteComment,
    addReaction,
    removeReaction,
  } = useComments(asset?.id || '', currentVersion?.id || '')

  // Open the comments panel by default on desktop; on mobile keep it hidden
  // unless the asset already has comments. Runs once; the user's later choice sticks.
  useEffect(() => {
    if (autoOpenedRef.current) return
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches
    if (isDesktop || comments.length > 0) {
      setSidebarOpen(true)
      autoOpenedRef.current = true
    }
  }, [comments.length])

  // Deep-link to a specific comment from notification (?commentId=...)
  // Runs once after comments are loaded — seeks to timecode, focuses comment, shows annotation
  useEffect(() => {
    const commentId = searchParams.get('commentId')
    if (!commentId || deepLinkApplied.current || comments.length === 0) return
    const target = comments.find((c: any) => c.id === commentId)
    if (!target) return
    deepLinkApplied.current = true
    setFocusedCommentId(commentId)
    if ((target as any).timecode_start !== null && (target as any).timecode_start !== undefined) {
      seekTo((target as any).timecode_start, true)
    }
    if ((target as any).annotation?.drawing_data) {
      setActiveAnnotation((target as any).annotation.drawing_data)
    }
  }, [comments, searchParams, seekTo, setFocusedCommentId, setActiveAnnotation])

  // Asset navigation
  const currentIndex = allAssets?.findIndex((a) => a.id === asset?.id) ?? -1
  const totalAssets = allAssets?.length ?? 0
  const prevAsset = currentIndex > 0 ? allAssets?.[currentIndex - 1] : null
  const nextAsset = currentIndex < totalAssets - 1 ? allAssets?.[currentIndex + 1] : null

  const navigateAsset = (assetId: string) => {
    router.push(`/projects/${projectId}/assets/${assetId}`)
  }

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(`/projects/${asset?.project_id ?? projectId}`)
    }
  }

  // Keyboard navigation for prev/next asset
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' && prevAsset) {
        e.preventDefault()
        navigateAsset(prevAsset.id)
      }
      if (e.key === 'ArrowRight' && nextAsset) {
        e.preventDefault()
        navigateAsset(nextAsset.id)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [prevAsset, nextAsset])

  if (reviewError || projectError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Access denied</h1>
          <p className="mt-1 text-sm text-text-tertiary">Your access to this asset is no longer active.</p>
        </div>
      </div>
    )
  }

  if (isLoading || !asset || !project) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="text-xs text-text-tertiary">Loading asset...</span>
        </div>
      </div>
    )
  }

  const handleSubmitComment = async (
    body: string,
    timecodeStart?: number,
    timecodeEnd?: number,
    annotation?: Record<string, unknown>,
    parentId?: string,
    visibility?: string,
    mentionUserIds?: string[],
  ) => {
    await createComment(
      body,
      timecodeStart,
      timecodeEnd,
      annotation || annotationData || undefined,
      parentId,
      visibility,
      mentionUserIds,
    )
    setAnnotationData(null)
    refetchComments()
  }

  const handleSubmitReply = async (parentId: string, body: string) => {
    await createComment(body, undefined, undefined, undefined, parentId)
    refetchComments()
  }

  const versionReady = currentVersion?.processing_status === 'ready'
  const versionProcessing =
    currentVersion?.processing_status === 'processing' ||
    currentVersion?.processing_status === 'uploading'

  const renderMediaViewer = () => {
    if (!currentVersion || !versionReady) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center px-6">
            {versionProcessing ? (
              <>
                <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Processing asset</p>
                  <p className="text-xs text-text-tertiary mt-1">
                    This may take a few minutes depending on file size.
                  </p>
                </div>
              </>
            ) : currentVersion?.processing_status === 'failed' ? (
              <>
                <div className="h-12 w-12 rounded-full bg-status-error/10 flex items-center justify-center">
                  <Info className="h-6 w-6 text-status-error" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Processing failed</p>
                  <p className="text-xs text-text-tertiary mt-1">
                    Try uploading a new version of this asset.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="h-12 w-12 rounded-full bg-bg-tertiary flex items-center justify-center">
                  <Info className="h-6 w-6 text-text-tertiary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Version not ready</p>
                  <p className="text-xs text-text-tertiary mt-1">
                    This version is still being prepared.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )
    }

    switch (asset.asset_type) {
      case 'video':
        return (
          <VideoPlayer
            assetId={asset.id}
            comments={comments}
            className="flex-1 min-h-0"
            onDownload={folderDirect ? undefined : handleDownload}
            overlay={
              <>
                <AnnotationOverlay key={focusedCommentId ?? 'none'} />
                {isDrawingMode && (
                  <AnnotationCanvas
                    onSave={(data) => setAnnotationData(data)}
                  />
                )}
              </>
            }
          />
        )
      case 'audio':
        return (
          <AudioPlayer
            asset={asset}
            version={currentVersion}
            comments={comments}
            className="flex-1"
          />
        )
      case 'image':
      case 'image_carousel':
        return (
          <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
            <ImageViewer
              asset={asset}
              version={currentVersion as any}
              annotationCanvas={
                <>
                  <AnnotationOverlay key={focusedCommentId ?? 'none'} />
                  {isDrawingMode && (
                    <AnnotationCanvas
                      onSave={(data) => setAnnotationData(data)}
                    />
                  )}
                </>
              }
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 sm:px-5 h-14 bg-bg-primary shrink-0">
        {/* Left: back + breadcrumb */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center h-8 w-8 rounded border border-transparent text-text-secondary hover:text-text-primary hover:border-border transition-colors shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Asset name only */}
          <span className="text-sm font-semibold tracking-[-0.01em] text-text-primary truncate">
            {asset.name}
          </span>
        </div>

        {/* Center: asset navigation */}
        {totalAssets > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => prevAsset && navigateAsset(prevAsset.id)}
              disabled={!prevAsset}
              className="flex items-center justify-center h-8 w-8 rounded border border-transparent text-text-secondary hover:text-text-primary hover:border-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous asset (←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="hidden sm:inline font-dot text-xs text-text-secondary tabular-nums px-1">
              {currentIndex + 1} of {totalAssets}
            </span>
            <button
              onClick={() => nextAsset && navigateAsset(nextAsset.id)}
              disabled={!nextAsset}
              className="flex items-center justify-center h-8 w-8 rounded border border-transparent text-text-secondary hover:text-text-primary hover:border-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next asset (→)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Right: version, share, sidebar toggle */}
        <div className="flex items-center gap-2 shrink-0 flex-1 justify-end">
          {/* Hidden file input for new version upload */}
          {!folderDirect && <input
            ref={versionFileInputRef}
            type="file"
            className="hidden"
            accept={acceptByType[asset.asset_type] ?? '*/*'}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file || !asset) return
              startVersionUpload(file, asset.id, asset.name, asset.project_id)
              e.target.value = ''
              // Refetch versions after a short delay to show the new uploading version
              setTimeout(() => refetchVersions(), 800)
            }}
          />}
          <VersionSwitcher versions={versions} />
          {!folderDirect && <button
            onClick={() => versionFileInputRef.current?.click()}
            className="hidden md:inline-flex h-[34px] items-center gap-2 rounded border border-border-strong px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary hover:border-text-primary hover:bg-bg-hover transition-colors"
            title="Upload new version"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New version</span>
          </button>}
          {!folderDirect && <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex h-[34px] items-center gap-2 rounded border border-border-strong px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary hover:border-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
            title="Download original file"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Download</span>
          </button>}
          {!folderDirect && <div className="hidden md:block">
            <ShareDialog assetId={asset.id} assetName={asset.name} projectId={projectId} asset={asset} />
          </div>}
          <button
            onClick={() => setSidebarOpen((p) => !p)}
            className={cn(
              'hidden md:flex items-center justify-center h-[34px] w-[34px] rounded border transition-colors',
              sidebarOpen
                ? 'border-border-strong text-text-primary'
                : 'border-border text-text-secondary hover:text-text-primary hover:border-border-strong',
            )}
            title="Toggle sidebar"
          >
            <Columns2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {canApprove && currentVersion && (
        <ApprovalBar
          assetId={asset.id}
          versionId={currentVersion.id}
          currentUserId={user?.id}
        />
      )}

      {/* ─── Main content: viewer + sidebar ────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        {/* Left: viewer column */}
        <div className="ff-dotgrid flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
          {/* Media viewer */}
          {renderMediaViewer()}
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

        {/* Right: comments sidebar */}
        {sidebarOpen && (
          <div
            className={cn(
              'w-full flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150 md:h-auto md:w-[372px]',
              isDrawingMode ? 'h-auto' : 'h-[55vh]',
            )}
          >
            <button
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border',
                isDrawingMode && 'hidden',
              )}
            >
              <ChevronDown className="h-4 w-4" />
              Hide comments
            </button>

            {/* Content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className={cn('flex-1 flex flex-col min-h-0 overflow-hidden', isDrawingMode && 'hidden md:flex')}>
                {folderDirect && !canComment ? (
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {comments.length === 0 ? (
                      <p className="text-xs text-text-tertiary">No comments yet</p>
                    ) : comments.map((comment) => (
                      <div key={comment.id} className="rounded border border-border bg-bg-primary p-3">
                        <p className="text-xs font-medium text-text-secondary">
                          {comment.author?.name ?? comment.guest_author?.name ?? 'Reviewer'}
                        </p>
                        <p className="mt-1 text-sm text-text-primary whitespace-pre-wrap">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                ) : <CommentPanel
                  comments={comments as any}
                  currentUserId={user?.id}
                  onResolve={resolveComment}
                  onDelete={deleteComment}
                  onAddReaction={addReaction}
                  onRemoveReaction={removeReaction}
                  onReply={() => {}}
                  onSubmitReply={handleSubmitReply}
                />}
              </div>
              {canComment && (
                <CommentInput
                  assetId={asset.id}
                  projectId={asset.project_id}
                  assetType={asset.asset_type}
                  onSubmit={handleSubmitComment}
                  annotationData={annotationData}
                />
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

export default function ReviewPage({
  params,
}: {
  params: { id: string; assetId: string }
}) {
  const { id: projectId, assetId } = params

  return (
    <ReviewProvider assetId={assetId}>
      <ReviewScreenInner projectId={projectId} />
    </ReviewProvider>
  )
}
