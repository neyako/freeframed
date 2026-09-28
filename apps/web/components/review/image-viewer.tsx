'use client'

import * as React from 'react'
import {
  TransformWrapper,
  TransformComponent,
  useControls,
} from 'react-zoom-pan-pinch'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Scan,
  } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useReviewStore } from '@/stores/review-store'
import { useReview } from '@/components/review/review-provider'
import type { Asset, AssetVersion } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamResponse {
  url: string
}

// ─── Zoom Controls ────────────────────────────────────────────────────────────

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform, centerView } = useControls()

  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1">
      <button
        onClick={() => zoomIn()}
        className="flex h-8 w-8 items-center justify-center rounded bg-bg-elevated text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary border border-border"
        title="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        onClick={() => zoomOut()}
        className="flex h-8 w-8 items-center justify-center rounded bg-bg-elevated text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary border border-border"
        title="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        onClick={() => centerView(1)}
        className="flex h-8 w-8 items-center justify-center rounded bg-bg-elevated text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary border border-border"
        title="Actual size"
      >
        <Scan className="h-4 w-4" />
      </button>
      <button
        onClick={() => resetTransform()}
        className="flex h-8 w-8 items-center justify-center rounded bg-bg-elevated text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary border border-border"
        title="Fit to screen"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Single Image View ─────────────────────────────────────────────────────────

interface SingleImageProps {
  url: string
  alt: string
  containerRef: React.RefObject<HTMLDivElement>
  onImageLoad: (width: number, height: number) => void
}

function SingleImage({ url, alt, containerRef, onImageLoad, annotationOverlay, isDrawingMode }: SingleImageProps & { annotationOverlay?: React.ReactNode; isDrawingMode?: boolean }) {
  const imgRef = React.useRef<HTMLImageElement>(null)

  const handleLoad = () => {
    const img = imgRef.current
    if (img) {
      onImageLoad(img.naturalWidth, img.naturalHeight)
    }
  }

  return (
    <div ref={containerRef} className="relative flex items-center justify-center w-full h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={url}
        alt={alt}
        onLoad={handleLoad}
        className="max-w-full max-h-full object-contain select-none"
        draggable={false}
      />
      {/* Annotation overlay — positioned on top of the image, moves with zoom/pan */}
      {annotationOverlay && (
        <div
          className="absolute inset-0"
          style={{ pointerEvents: isDrawingMode ? 'auto' : 'none' }}
        >
          {annotationOverlay}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ImageSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-secondary">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-text-tertiary">Loading image…</p>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface ImageViewerProps {
  asset: Asset
  version: AssetVersion | null
  className?: string
  /** Optional: rendered on top of the image for annotations */
  annotationCanvas?: React.ReactNode
}

export function ImageViewer({ asset, version, className, annotationCanvas }: ImageViewerProps) {
  const { isDrawingMode, setFocusedCommentId, setActiveAnnotation } = useReviewStore()

  const handleImageClick = () => {
    if (!isDrawingMode) {
      setFocusedCommentId(null)
      setActiveAnnotation(null)
    }
  }

  // Presigned stream URL for the current version
  const [imageUrl, setImageUrl] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Displayed image natural dimensions (used to size the annotation canvas)
  const [imageDimensions, setImageDimensions] = React.useState<{ w: number; h: number } | null>(
    null,
  )

  const containerRef = React.useRef<HTMLDivElement>(null)

  // Access share context for share-mode stream fetching
  let shareToken: string | undefined
  let shareSession: string | null | undefined
  try {
    const review = useReview()
    shareToken = review.shareToken
    shareSession = review.shareSession
  } catch {
    // Not inside ReviewProvider — normal mode
  }

  // Fetch stream URL
  React.useEffect(() => {
    if (!version) return

    // In share mode, fetch via share endpoint
    if (shareToken) {
      let cancelled = false
      setIsLoading(true)
      setError(null)
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const sp = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''
      fetch(`${API_URL}/share/${shareToken}/stream/${asset.id}?version_id=${version.id}${sp}`, {
        credentials: 'include',
      })
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load image')))
        .then(data => { if (!cancelled) setImageUrl(data.url) })
        .catch(err => { if (!cancelled) setError(err.message) })
        .finally(() => { if (!cancelled) setIsLoading(false) })
      return () => { cancelled = true }
    }

    let cancelled = false

    const fetchUrl = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const data = await api.get<StreamResponse>(`/assets/${asset.id}/stream?version_id=${version.id}`)
        if (!cancelled) setImageUrl(data.url)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load image')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchUrl()
    return () => {
      cancelled = true
    }
  }, [asset.id, shareToken, version?.id])

  const handleImageLoad = (w: number, h: number) => {
    setImageDimensions({ w, h })
  }

  if (isLoading) {
    return <ImageSkeleton />
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-secondary">
        <p className="text-sm text-status-error">{error}</p>
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg-secondary">
        <p className="text-sm text-text-tertiary">No image available</p>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-full w-full flex-col overflow-hidden bg-bg-primary', className)}>
      {/* Zoom/pan area — click to deselect comment & hide annotation */}
      <div className="relative flex-1 overflow-hidden" onClick={handleImageClick}>
        <TransformWrapper
          key={imageUrl}
          initialScale={1}
          minScale={0.1}
          maxScale={10}
          centerOnInit
          wheel={{ step: 0.08 }}
          pinch={{ step: 5 }}
          disabled={isDrawingMode}
        >
          {() => (
            <>
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <SingleImage
                  url={imageUrl}
                  alt={asset.name}
                  containerRef={containerRef}
                  onImageLoad={handleImageLoad}
                  annotationOverlay={annotationCanvas}
                  isDrawingMode={isDrawingMode}
                />
              </TransformComponent>

              <ZoomControls />
            </>
          )}
        </TransformWrapper>
      </div>
    </div>
  )
}
