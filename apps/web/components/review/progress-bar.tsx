'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Hls from 'hls.js'
import { cn, formatTimecode } from '@/lib/utils'
import { avatarGray, getInitials } from '@/lib/avatar'
import { useReviewStore } from '@/stores/review-store'
import type { Comment } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressBarProps {
  currentTime: number
  duration: number
  buffered?: number
  comments?: Comment[]
  videoRef?: React.RefObject<HTMLVideoElement | null>
  streamUrl?: string | null
  onSeek: (time: number) => void
  className?: string
}

// ─── Frame Preview Hook ───────────────────────────────────────────────────────

function useFramePreview(streamUrl: string | null | undefined) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const previewHlsRef = useRef<Hls | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seekResolveRef = useRef<(() => void) | null>(null)
  const readyRef = useRef(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  // Initialize hidden preview video + HLS
  useEffect(() => {
    if (!streamUrl) return

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.style.display = 'none'
    document.body.appendChild(video)
    previewVideoRef.current = video

    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 90
    canvasRef.current = canvas

    const isHls = streamUrl.includes('.m3u8')

    const onReady = () => {
      readyRef.current = true
    }

    video.addEventListener('loadeddata', onReady)

    video.addEventListener('seeked', () => {
      // Capture frame
      try {
        const ctx = canvas.getContext('2d')
        if (ctx && video.videoWidth > 0) {
          const aspectRatio = video.videoWidth / video.videoHeight
          const w = 160
          const h = Math.round(w / aspectRatio)
          canvas.width = w
          canvas.height = h
          ctx.drawImage(video, 0, 0, w, h)
          setPreviewImage(canvas.toDataURL('image/jpeg', 0.7))
        }
      } catch {
        // CORS — silently fail
      }
      seekResolveRef.current?.()
      seekResolveRef.current = null
    })

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        maxBufferLength: 1,
        maxMaxBufferLength: 2,
        maxBufferSize: 0.5 * 1024 * 1024, // 500KB — minimal buffering
      })
      previewHlsRef.current = hls
      hls.loadSource(streamUrl)
      hls.attachMedia(video)
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
    } else {
      video.src = streamUrl
    }

    return () => {
      readyRef.current = false
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy()
        previewHlsRef.current = null
      }
      video.removeEventListener('loadeddata', onReady)
      video.src = ''
      video.remove()
      previewVideoRef.current = null
      canvasRef.current = null
      setPreviewImage(null)
    }
  }, [streamUrl])

  const seekPreview = useCallback((time: number) => {
    const video = previewVideoRef.current
    if (!video || !readyRef.current) return
    // Debounce: if already seeking, skip
    if (seekResolveRef.current) return
    seekResolveRef.current = () => {}
    video.currentTime = Math.max(0, time)
  }, [])

  const clearPreview = useCallback(() => {
    setPreviewImage(null)
  }, [])

  return { previewImage, seekPreview, clearPreview }
}

// ─── Comment Marker ──────────────────────────────────────────────────────────

interface CommentMarkerProps {
  comment: Comment
  leftPercent: number
  authorName: string
  avatarUrl: string | null
  extraCount: number
  isHovered: boolean
  isFocused: boolean
  onHover: () => void
  onLeave: () => void
  onSeek: (time: number) => void
}

function CommentMarker({
  comment,
  leftPercent,
  authorName,
  avatarUrl,
  extraCount,
  isHovered,
  isFocused,
  onHover,
  onLeave,
  onSeek,
}: CommentMarkerProps) {
  const initials = getInitials(authorName)
  const markerRef = useRef<HTMLDivElement>(null)
  const setFocusedCommentId = useReviewStore((s) => s.setFocusedCommentId)
  const setActiveAnnotation = useReviewStore((s) => s.setActiveAnnotation)
  const seekTo = useReviewStore((s) => s.seekTo)
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null)

  // Recalculate tooltip position when hovered to avoid viewport clipping
  useEffect(() => {
    if (!isHovered || !markerRef.current) {
      setTooltipPos(null)
      return
    }
    const rect = markerRef.current.getBoundingClientRect()
    const tooltipWidth = 240
    let left = rect.left + rect.width / 2 - tooltipWidth / 2
    if (left < 8) left = 8
    if (left + tooltipWidth > window.innerWidth - 8) left = window.innerWidth - 8 - tooltipWidth
    setTooltipPos({ left, top: rect.top - 8 })
  }, [isHovered])

  const handleClick = useCallback(() => {
    if (comment.timecode_start !== null) {
      seekTo(comment.timecode_start, true)
    }
    setFocusedCommentId(comment.id)
    if ((comment as any).annotation?.drawing_data) {
      setActiveAnnotation((comment as any).annotation.drawing_data)
    } else {
      setActiveAnnotation(null)
    }
  }, [comment, seekTo, setFocusedCommentId, setActiveAnnotation])

  return (
    <div
      ref={markerRef}
      className="absolute top-0 -translate-x-1/2 cursor-pointer"
      style={{ left: `${leftPercent}%` }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={handleClick}
    >
      {/* Avatar dot — reviewer photo when available, mono initials otherwise */}
      <div
        className={cn(
          'relative w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 transition-transform hover:scale-110',
          isFocused ? 'border-accent scale-125 ring-2 ring-accent/40' : 'border-bg-primary',
        )}
        style={avatarUrl ? undefined : { backgroundColor: avatarGray(authorName) }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={authorName} className="w-full h-full rounded-full object-cover" />
        ) : (
          initials
        )}
        {extraCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-bg-elevated border border-border px-0.5 text-[8px] font-bold text-text-primary">
            +{extraCount}
          </span>
        )}
      </div>

      {/* Tooltip — portaled to document.body to escape all overflow */}
      {isHovered && tooltipPos && createPortal(
        <div
          style={{
            position: 'fixed',
            left: tooltipPos.left,
            top: tooltipPos.top,
            width: 240,
            transform: 'translateY(-100%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
        >
          <div className="bg-bg-elevated border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={authorName}
                  className="w-5 h-5 rounded-full object-cover shrink-0"
                />
              ) : (
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                  style={{ backgroundColor: avatarGray(authorName) }}
                >
                  {initials}
                </div>
              )}
              <span className="text-xs font-medium text-text-primary truncate">{authorName}</span>
              {comment.timecode_start !== null && (
                <span className="ml-auto text-[10px] font-dot font-bold text-accent bg-accent-muted px-1.5 py-0.5 rounded whitespace-nowrap">
                  {formatTimecode(comment.timecode_start)}
                  {comment.timecode_end != null &&
                    ` – ${formatTimecode(comment.timecode_end)}`}
                </span>
              )}
            </div>
            <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
              {comment.body}
            </p>
          </div>
          {/* Arrow */}
          <div className="flex justify-center">
            <div className="w-2 h-2 bg-bg-elevated border-b border-r border-border rotate-45 -mt-1" />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProgressBar({
  currentTime,
  duration,
  buffered = 0,
  comments = [],
  streamUrl,
  onSeek,
  className,
}: ProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null)
  const focusedCommentId = useReviewStore((s) => s.focusedCommentId)
  const setFocusedCommentId = useReviewStore((s) => s.setFocusedCommentId)
  const rangeStart = useReviewStore((s) => s.rangeStart)
  const rangeEnd = useReviewStore((s) => s.rangeEnd)

  const { previewImage, seekPreview, clearPreview } = useFramePreview(streamUrl)

  const timeToPercent = useCallback(
    (time: number): number => {
      if (!duration) return 0
      return Math.max(0, Math.min(100, (time / duration) * 100))
    },
    [duration],
  )

  const getTimeFromEvent = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || !duration) return 0
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [duration],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const time = getTimeFromEvent(e.clientX)
      setHoverTime(time)
      const track = trackRef.current
      if (track) {
        const rect = track.getBoundingClientRect()
        setHoverX(e.clientX - rect.left)
      }
      if (isDragging) {
        onSeek(time)
      }
      seekPreview(time)
    },
    [isDragging, getTimeFromEvent, onSeek, seekPreview],
  )

  const handleMouseLeave = useCallback(() => {
    if (!isDragging) {
      setHoverTime(null)
      clearPreview()
    }
  }, [isDragging, clearPreview])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(true)
      onSeek(getTimeFromEvent(e.clientX))
    },
    [getTimeFromEvent, onSeek],
  )

  // Global mouse up / move to handle drag outside track
  useEffect(() => {
    if (!isDragging) return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      onSeek(getTimeFromEvent(e.clientX))
    }

    const handleGlobalMouseUp = (e: MouseEvent) => {
      setIsDragging(false)
      setHoverTime(null)
      clearPreview()
      onSeek(getTimeFromEvent(e.clientX))
    }

    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDragging, getTimeFromEvent, onSeek, clearPreview])

  // Every timecoded comment gets an avatar marker; range comments also get a span
  const pointMarkers = comments.filter(
    (c) => c.timecode_start !== null && !c.resolved,
  )
  const rangeMarkers = comments.filter(
    (c) => c.timecode_start !== null && c.timecode_end !== null && !c.resolved,
  )

  // Cluster markers that sit within a few percent of each other so the avatar
  // row doesn't overlap on narrow/mobile widths — lead avatar carries a +N badge.
  const CLUSTER_PCT = 4
  const markerBuckets: { lead: Comment; left: number; extra: number }[] = []
  for (const c of [...pointMarkers].sort(
    (a, b) => (a.timecode_start ?? 0) - (b.timecode_start ?? 0),
  )) {
    const left = timeToPercent(c.timecode_start ?? 0)
    const last = markerBuckets[markerBuckets.length - 1]
    if (last && left - last.left < CLUSTER_PCT) last.extra += 1
    else markerBuckets.push({ lead: c, left, extra: 0 })
  }

  const playPercent = timeToPercent(currentTime)
  const bufferedPercent = timeToPercent(buffered)

  return (
    <div className={cn('relative flex flex-col w-full group/progress py-1', className)}>
      {/* Track area */}
      <div
        ref={trackRef}
        className="relative w-full h-1 group-hover/progress:h-1.5 transition-all duration-150 cursor-pointer bg-border rounded-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
      >
        {/* Buffered range */}
        <div
          className="absolute inset-y-0 left-0 bg-border-secondary rounded-full"
          style={{ width: `${bufferedPercent}%` }}
        />

        {/* Playback progress */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${playPercent}%`,
            background: 'var(--accent)',
          }}
        />

        {/* Time-range comment spans — above the fill so they stay visible in the played region */}
        {rangeMarkers.map((c) => {
          if (c.timecode_start === null || c.timecode_end === null) return null
          const left = timeToPercent(c.timecode_start)
          const right = timeToPercent(c.timecode_end)
          const isActive = hoveredCommentId === c.id || focusedCommentId === c.id
          return (
            <div
              key={c.id}
              className={cn(
                'absolute -inset-y-[1px] rounded-full border cursor-pointer transition-colors',
                isActive
                  ? 'border-white/90 bg-white/40'
                  : 'border-white/60 bg-white/20 hover:bg-white/40',
              )}
              style={{
                left: `${left}%`,
                width: `${right - left}%`,
              }}
              onMouseEnter={() => setHoveredCommentId(c.id)}
              onMouseLeave={() => setHoveredCommentId(null)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onSeek(c.timecode_start!)
                setFocusedCommentId(c.id)
              }}
            />
          )
        })}

        {/* Live range preview while marking in/out */}
        {(rangeStart !== null || rangeEnd !== null) &&
          (() => {
            const a = rangeStart ?? currentTime
            const b = rangeEnd ?? currentTime
            const left = timeToPercent(Math.min(a, b))
            const width = Math.max(timeToPercent(Math.abs(b - a)), 0.4)
            return (
              <div
                className="absolute -inset-y-[1px] rounded-full border border-dashed border-white/80 bg-white/15 pointer-events-none"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            )
          })()}

        {/* Playhead thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none z-10"
          style={{ left: `${playPercent}%`, transform: 'translateX(-50%) translateY(-50%)' }}
        />
      </div>

      {/* Comment markers row — below the progress bar */}
      {markerBuckets.length > 0 && (
        <div className="relative w-full h-6 mt-0.5">
          {markerBuckets.map(({ lead, left, extra }) => {
            const authorName = lead.author?.name ?? lead.guest_author?.name ?? 'Unknown'
            return (
              <CommentMarker
                key={lead.id}
                comment={lead}
                leftPercent={left}
                authorName={authorName}
                avatarUrl={lead.author?.avatar_url ?? null}
                extraCount={extra}
                isHovered={hoveredCommentId === lead.id}
                isFocused={focusedCommentId === lead.id}
                onHover={() => setHoveredCommentId(lead.id)}
                onLeave={() => setHoveredCommentId(null)}
                onSeek={onSeek}
              />
            )
          })}
        </div>
      )}

      {/* Frame preview + time tooltip on bar hover */}
      {hoverTime !== null && (
        <div
          className="absolute -top-2 z-30 pointer-events-none"
          style={{ left: hoverX, transform: 'translateX(-50%) translateY(-100%)' }}
        >
          {/* Frame preview */}
          {previewImage && (
            <div className="mb-1 rounded-md overflow-hidden border border-border-strong">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewImage} alt="" className="w-40 object-contain bg-black" />
            </div>
          )}
          {/* Time label */}
          <div className="flex justify-center">
            <span className="bg-bg-elevated border border-border text-text-primary text-[11px] font-dot font-bold px-2 py-0.5 rounded-md">
              {formatTimecode(hoverTime)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
