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
import { CommentInput, type CommentDraft } from '@/components/review/comment-input'
import { ApprovalBar } from '@/components/review/approval-bar'
import { VersionNameMenu, VersionSwitcher } from '@/components/review/version-switcher'
import { CutSummary } from '@/components/review/cut-summary'
import { Button } from '@/components/ui/button'
import { ShareDialog } from '@/components/review/share-dialog'
import { useReviewStore } from '@/stores/review-store'
import { useAuthStore } from '@/stores/auth-store'
import { useComments, uploadCommentAttachments } from '@/hooks/use-comments'
import { api } from '@/lib/api'
import { canGoBackInApp } from '@/lib/navigation'
import { useUploadStore } from '@/stores/upload-store'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Columns2,
  MessageSquare,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import type { ApiError } from '@/lib/api'
import type { AssetResponse, FolderTreeNode, Project } from '@/types'

const acceptByType: Record<string, string> = {
  video: 'video/*',
  audio: 'audio/*',
  image: 'image/*',
}

function findPath(
  nodes: FolderTreeNode[],
  targetId: string,
  trail: { id: string; name: string }[] = [],
): { id: string; name: string }[] | null {
  for (const node of nodes) {
    const next = [...trail, { id: node.id, name: node.name }]
    if (node.id === targetId) return next
    const found = findPath(node.children, targetId, next)
    if (found) return found
  }
  return null
}

function ReviewScreenInner({ projectId }: { projectId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { asset, versions, isLoading, error: reviewError, refetchVersions } = useReview()
  const { currentVersion, isDrawingMode, focusedCommentId, seekTo, setCurrentVersion, setFocusedCommentId, setActiveAnnotation } = useReviewStore()
  const { user } = useAuthStore()
  const startVersionUpload = useUploadStore((s) => s.startVersionUpload)
  const versionFileInputRef = useRef<HTMLInputElement>(null)
  const setExtraCrumbs = useBreadcrumbStore((s) => s.setExtraCrumbs)
  const setLabel = useBreadcrumbStore((s) => s.setLabel)
  usePageTitle(asset?.name ?? null)
  const [annotationData, setAnnotationData] = useState<Record<string, unknown> | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [targetOverride, setTargetOverride] = useState<{ assetId: string; seconds: number | null } | null>(null)

  const { data: project, error: projectError } = useSWR<Project, ApiError>(
    `/projects/${projectId}`,
    () => api.get<Project>(`/projects/${projectId}`),
  )
  // Only a refusal means lost access. A dropped request (a download starting,
  // flaky mobile network) must not take down a page that already loaded.
  const projectDenied = projectError?.status === 403 || projectError?.status === 404

  async function handleDownload() {
    if (!asset || !currentVersion || downloading) return
    setDownloading(true)
    try {
      const res = await api.get<{ url: string }>(
        `/assets/${asset.id}/stream?download=true&version_id=${currentVersion.id}`,
      )
      // An empty `download` keeps the page in place (mobile Safari otherwise
      // navigates away) and lets the server's Content-Disposition filename win
      const a = document.createElement('a')
      a.href = res.url
      a.download = ''
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
    asset && project && !reviewError && !projectDenied
      ? `/projects/${projectId}/folder-tree`
      : null,
    () => api.get<FolderTreeNode[]>(`/projects/${projectId}/folder-tree`),
  )

  // Set extra crumbs = [folder path..., asset name]
  // Don't register asset UUID as a label — use extraCrumbs for correct ordering
  useEffect(() => {
    if (!asset?.name) return

    const folderPath = asset.folder_id && folderTree
      ? (findPath(folderTree, asset.folder_id, []) ?? [])
      : []

    setExtraCrumbs([
      ...folderPath.map((f) => ({ label: f.name, href: `/projects/${projectId}?folder=${f.id}` })),
      { label: asset.name }, // asset name — no href (current page)
    ])
  }, [asset?.id, asset?.name, asset?.folder_id, folderTree, setExtraCrumbs])

  // Leaving the review screen must drop its folder/asset crumbs — the header
  // renders extraCrumbs on every route, so stale crumbs would otherwise ghost
  // on pages with no URL crumbs (e.g. the dashboard after clicking Back).
  useEffect(() => () => setExtraCrumbs([]), [setExtraCrumbs])

  useEffect(() => {
    if (project?.name) setLabel(projectId, project.name)
  }, [project?.name, projectId, setLabel])

  // Fetch all assets for navigation (1 of N)
  const { data: allAssets } = useSWR<AssetResponse[]>(
    project && !reviewError && !projectDenied ? `/projects/${projectId}/assets` : null,
    () => api.get<AssetResponse[]>(`/projects/${projectId}/assets`),
  )

  const {
    comments,
    createComment,
    resolveComment,
    toggleCut,
    deleteComment,
    addReaction,
    removeReaction,
    mutate: mutateComments,
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

  // Comment links carry the comment's version (?versionId=...) — open that one
  const deepLinkVersionApplied = useRef(false)
  useEffect(() => {
    const versionId = searchParams.get('versionId')
    if (!versionId || deepLinkVersionApplied.current || versions.length === 0) return
    deepLinkVersionApplied.current = true
    const target = versions.find((v) => v.id === versionId)
    if (target && target.id !== currentVersion?.id) setCurrentVersion(target)
  }, [versions, searchParams, currentVersion?.id, setCurrentVersion])

  // Deep-link to a specific comment (?commentId=...)
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
    // Return the viewer to wherever they opened the asset from — dashboard
    // or command palette — instead of a project they may never
    // have visited. History also restores the exact folder query, which
    // reconstructing the URL by hand did not.
    if (canGoBackInApp(window.history, document.referrer, window.location.origin)) {
      router.back()
      return
    }
    // Share-link redirects (location.replace), fresh tabs and pasted URLs have
    // no in-app entry to return to. The dashboard is the safe landing spot —
    // notably for quick-share assets, whose container project is a system
    // record that isn't meant to be browsed.
    router.push('/')
  }

  // Keyboard navigation for prev/next asset
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // Video and audio players use the arrow keys to seek
      if (asset?.asset_type === 'video' || asset?.asset_type === 'audio') return
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
  }, [asset?.asset_type, prevAsset, nextAsset])

  if (reviewError || projectDenied) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Access denied</h1>
          <p className="mt-1 text-sm text-text-tertiary">Your access to this asset is no longer active.</p>
        </div>
      </div>
    )
  }

  if (isLoading || !asset || !project) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-text-tertiary">Loading…</div>
    )
  }

  const handleSubmitComment = async (draft: CommentDraft) => {
    const created = await createComment({
      ...draft,
      annotation: draft.annotation || annotationData || undefined,
    })
    if (draft.attachments?.length) {
      await uploadCommentAttachments(created.id, draft.attachments, draft.onAttachmentProgress)
      await mutateComments()
    }
    setAnnotationData(null)
  }

  const handleSubmitReply = async (parentId: string, body: string) => {
    await createComment({ body, parentId })
  }

  // Runtime goal lives on the asset; show the pick immediately, save in the background
  const target =
    targetOverride?.assetId === asset.id ? targetOverride.seconds : (asset.target_duration_seconds ?? null)
  const handleTargetChange = async (seconds: number | null) => {
    setTargetOverride({ assetId: asset.id, seconds })
    await api.patch(`/assets/${asset.id}`, { target_duration_seconds: seconds })
  }
  const runtime = currentVersion?.files?.find((f) => f.duration_seconds)?.duration_seconds ?? null

  const versionReady = currentVersion?.processing_status === 'ready'
  const versionProcessing =
    currentVersion?.processing_status === 'processing' ||
    currentVersion?.processing_status === 'uploading'

  const renderMediaViewer = () => {
    if (!currentVersion || !versionReady) {
      const failed = currentVersion?.processing_status === 'failed'
      return (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className={cn('text-[13px] font-medium', failed ? 'text-accent' : 'text-text-primary')}>
              {failed ? 'Processing failed' : versionProcessing ? 'Processing…' : 'Not ready yet'}
            </p>
            <p className="mt-1 text-[12.5px] text-text-tertiary">
              {failed ? 'Upload a new version to try again.' : 'This page updates when the version is ready.'}
            </p>
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
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-primary px-3 sm:px-4">
        <Button variant="ghost" size="sm" className="w-[30px] px-0" onClick={handleBack} aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          {/* Phones pick versions by tapping the name; wider screens get tabs */}
          <div className="hidden truncate text-[13px] font-medium leading-tight text-text-primary sm:block">{asset.name}</div>
          <VersionNameMenu name={asset.name} versions={versions} className="sm:hidden" />
          <div className="truncate text-[11.5px] leading-tight text-text-tertiary">
            {[project.name, ...(asset.folder_id && folderTree ? (findPath(folderTree, asset.folder_id) ?? []).map((f) => f.name) : [])].join(' / ')}
          </div>
        </div>
        <VersionSwitcher versions={versions} className="ml-1 hidden shrink-0 sm:flex" />

        <div className="flex flex-1 items-center justify-end gap-1">
          {totalAssets > 1 && (
            <div className="mr-1 hidden items-center md:flex">
              <Button variant="ghost" size="sm" className="w-[30px] px-0" onClick={() => prevAsset && navigateAsset(prevAsset.id)} disabled={!prevAsset} title="Previous asset">
                <ChevronLeft />
              </Button>
              <span className="px-1 font-mono text-[11.5px] tabular-nums text-text-tertiary">
                {currentIndex + 1}/{totalAssets}
              </span>
              <Button variant="ghost" size="sm" className="w-[30px] px-0" onClick={() => nextAsset && navigateAsset(nextAsset.id)} disabled={!nextAsset} title="Next asset">
                <ChevronRight />
              </Button>
            </div>
          )}
          {/* Hidden file input for new version upload */}
          <input
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
          />
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => versionFileInputRef.current?.click()}>
            <Upload />
            New version
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload} disabled={downloading} title="Download original file">
            <Download />
            <span className="hidden sm:inline">{downloading ? 'Preparing…' : 'Download'}</span>
          </Button>
          <ShareDialog assetId={asset.id} />
          <Button
            variant="ghost"
            size="sm"
            className={cn('hidden w-[30px] px-0 md:inline-flex', sidebarOpen && 'text-text-primary')}
            onClick={() => setSidebarOpen((p) => !p)}
            title="Toggle comments"
          >
            <Columns2 />
          </Button>
        </div>
      </div>

      {currentVersion && (
        <ApprovalBar
          assetId={asset.id}
          versionId={currentVersion.id}
          currentUserId={user?.id}
          versionCreatedBy={currentVersion.created_by}
        />
      )}

      {/* ─── Main content: viewer + sidebar ────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        {/* Left: viewer column */}
        <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
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
              'w-full flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-ff-rise-in md:animate-ff-slide-in md:h-auto md:w-[372px]',
              isDrawingMode ? 'h-auto' : 'h-[55vh]',
            )}
          >
            <button
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'md:hidden flex items-center justify-center w-full py-2 border-b border-border',
                isDrawingMode && 'hidden',
              )}
              aria-label="Hide comments"
            >
              <span className="h-1 w-8 rounded-full bg-border-strong" />
            </button>

            {/* Content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className={cn('flex-1 flex flex-col min-h-0 overflow-hidden', isDrawingMode && 'hidden md:flex')}>
                {runtime !== null && (asset.asset_type === 'video' || asset.asset_type === 'audio') && (
                  <CutSummary
                    comments={comments as any}
                    duration={runtime}
                    target={target}
                    onTargetChange={handleTargetChange}
                  />
                )}
                <CommentPanel
                  comments={comments as any}
                  currentUserId={user?.id}
                  onResolve={resolveComment}
                  onToggleCut={toggleCut}
                  onDelete={deleteComment}
                  onAddReaction={addReaction}
                  onRemoveReaction={removeReaction}
                  onReply={() => {}}
                  onSubmitReply={handleSubmitReply}
                  showExport
                />
              </div>
              <CommentInput
                assetId={asset.id}
                projectId={asset.project_id}
                assetType={asset.asset_type}
                onSubmit={handleSubmitComment}
                annotationData={annotationData}
              />
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
