'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Hls from 'hls.js'
import { cn, formatTimecode } from '@/lib/utils'
import { avatarGray, getInitials } from '@/lib/avatar'
import { useReviewStore } from '@/stores/review-store'
import { canUseHlsJs } from '@/hooks/use-video-player'
import { afterCutSeconds, toEditTime, toSourceTime, type CutRange } from '@/lib/cuts'
import type { Comment } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressBarProps {
  currentTime: number
  duration: number
  buffered?: number
  comments?: Comment[]
  videoRef?: React.RefObject<HTMLVideoElement | null>
  streamUrl?: string | null
  /** Set for the edit view: the bar runs on after-cut time, each cut collapsed to a join */
  cuts?: CutRange[] | null
  /** Source time, also in the edit view */
  onSeek: (time: number) => void
  className?: string
}

// ─── Frame Preview Hook ───────────────────────────────────────────────────────

function useFramePreview(streamUrl: string | null | undefined) {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const previewHlsRef = useRef<Hls | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seekingRef = useRef(false)
  // Hover time that arrived mid-seek; sought next so the frame matches where the cursor stopped
  const pendingTimeRef = useRef<number | null>(null)
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
      const next = pendingTimeRef.current
      if (next === null || seekingRef.current) return
      pendingTimeRef.current = null
      seekingRef.current = true
      video.currentTime = next
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
      const next = pendingTimeRef.current
      pendingTimeRef.current = null
      if (next === null) seekingRef.current = false
      else video.currentTime = next
    })

    if (isHls && canUseHlsJs()) {
      const hls = new Hls({
        enableWorker: false,
        preferManagedMediaSource: false,
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
      seekingRef.current = false
      pendingTimeRef.current = null
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
    if (!video) return
    // One seek in flight (or none yet possible); the latest hover waits and replaces any older one
    if (!readyRef.current || seekingRef.current) {
      pendingTimeRef.current = Math.max(0, time)
      return
    }
    seekingRef.current = true
    video.currentTime = Math.max(0, time)
  }, [])

  const clearPreview = useCallback(() => {
    pendingTimeRef.current = null
    setPreviewImage(null)
  }, [])

  return { previewImage, seekPreview, clearPreview }
}

/** Mouse work on the player leaves no focus behind in the comment box or on a
 * button, so the next I / O / Enter reaches the player shortcuts. */
export function releaseFocus() {
  ;(document.activeElement as HTMLElement | null)?.blur?.()
}

// ─── Comment Marker ──────────────────────────────────────────────────────────

// A mouse click on a comment marker focuses it instead of scrubbing, and its
// hover shows the comment rather than the frame preview. Touch passes through
// so a drag that starts on a marker still scrubs; a tap still clicks it.
function stopMouse(e: React.PointerEvent) {
  if (e.pointerType === 'mouse') e.stopPropagation()
}

interface CommentMarkerProps {
  comment: Comment
  leftPercent: number
  authorName: string
  avatarUrl: string | null
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
      className={cn('absolute top-0 -translate-x-1/2 cursor-pointer duration-300 ease-out hover:z-10', isFocused && 'z-10')}
      style={{ left: `${leftPercent}%` }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onPointerDown={stopMouse}
      onPointerMove={stopMouse}
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
                <span className="ml-auto text-[10px] font-mono tabular-nums text-accent bg-accent-muted px-1.5 py-0.5 rounded whitespace-nowrap">
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

/** Half of the hover preview's w-40 (160px) */
const PREVIEW_HALF_WIDTH = 80

export function ProgressBar({
  currentTime,
  duration,
  buffered = 0,
  comments = [],
  streamUrl,
  cuts,
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

  // Cuts added after first render grow in; ones already there on load don't.
  // Kept for the animation's length: the bar re-renders on every playhead tick.
  const seenCutIds = useRef<Set<string> | null>(null)
  const growingCutIds = useRef<Set<string>>(new Set())
  const cutIds = comments.filter((c) => c.is_cut).map((c) => c.id)
  if (seenCutIds.current) {
    for (const id of cutIds) {
      if (seenCutIds.current.has(id)) continue
      growingCutIds.current.add(id)
      setTimeout(() => growingCutIds.current.delete(id), 400)
    }
  }
  seenCutIds.current = new Set(cutIds)

  const { previewImage, seekPreview, clearPreview } = useFramePreview(streamUrl)

  // Bar time is source time, or after-cut time in the edit view
  const barDuration = cuts ? afterCutSeconds(duration, cuts) : duration
  const toBar = (time: number) => (cuts ? toEditTime(time, cuts) : time)
  const fromBar = useCallback((time: number) => (cuts ? toSourceTime(time, cuts) : time), [cuts])
  const barPercent = (barTime: number) =>
    barDuration ? Math.max(0, Math.min(100, (barTime / barDuration) * 100)) : 0
  const timeToPercent = (time: number) => barPercent(toBar(time))

  const getBarTime = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || !barDuration) return 0
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * barDuration
    },
    [barDuration],
  )

  // Pointer events cover mouse, touch and pen alike. Capturing the pointer
  // keeps a drag alive when the cursor leaves the thin track. Touch is
  // already captured by the touched element; re-capturing it here would
  // steal a marker tap's click.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      // preventDefault also skips the mousedown that would have blurred the comment box
      e.preventDefault()
      releaseFocus()
      if (e.pointerType !== 'touch') e.currentTarget.setPointerCapture(e.pointerId)
      setIsDragging(true)
      onSeek(fromBar(getBarTime(e.clientX)))
    },
    [getBarTime, fromBar, onSeek],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const barTime = getBarTime(e.clientX)
      const time = fromBar(barTime)
      setHoverTime(barTime)
      const track = trackRef.current
      if (track) {
        const rect = track.getBoundingClientRect()
        // Pin the fixed-width preview inside the bar so it never shrinks or clips at the ends
        setHoverX(Math.max(PREVIEW_HALF_WIDTH, Math.min(rect.width - PREVIEW_HALF_WIDTH, e.clientX - rect.left)))
      }
      if (isDragging) {
        onSeek(time)
      }
      seekPreview(time)
    },
    [isDragging, getBarTime, fromBar, onSeek, seekPreview],
  )

  const endDrag = useCallback(() => {
    setIsDragging(false)
    setHoverTime(null)
    clearPreview()
  }, [clearPreview])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      onSeek(fromBar(getBarTime(e.clientX)))
      endDrag()
    },
    [isDragging, getBarTime, fromBar, onSeek, endDrag],
  )

  const handlePointerLeave = useCallback(() => {
    if (!isDragging) {
      setHoverTime(null)
      clearPreview()
    }
  }, [isDragging, clearPreview])

  // Every timecoded comment gets an avatar marker; range comments also get a span
  const pointMarkers = comments.filter(
    (c) => c.timecode_start !== null && !c.resolved,
  )
  const rangeMarkers = comments.filter(
    (c) => c.timecode_start !== null && c.timecode_end !== null && !c.resolved,
  )

  const playPercent = timeToPercent(currentTime)
  const bufferedPercent = timeToPercent(buffered)

  return (
    // The whole strip (track + marker row) scrubs and is touch-none: a finger
    // landing beside the thin track would otherwise pan the page instead.
    <div
      className={cn('relative flex flex-col w-full group/progress py-1 cursor-pointer touch-none', className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={endDrag}
      onPointerLeave={handlePointerLeave}
    >
      {/* Track area */}
      <div
        ref={trackRef}
        className="relative w-full h-1.5 group-hover/progress:h-2 bg-border rounded-full before:absolute before:-inset-y-3 before:content-['']"
      >
        {/* Buffered range */}
        <div
          className="absolute inset-y-0 left-0 bg-border-secondary rounded-full"
          style={{ width: `${bufferedPercent}%` }}
        />

        {/* Playback progress: neutral, so red stays reserved for cuts */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-text-primary/35"
          style={{ width: `${playPercent}%` }}
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
                'absolute -inset-y-[1px] rounded-full cursor-pointer',
                c.is_cut
                  ? cn('cut-hatch origin-left', growingCutIds.current.has(c.id) && 'animate-ff-grow-x', isActive && 'ring-1 ring-white/80')
                  : cn('border', isActive ? 'border-white/90 bg-white/40' : 'border-white/60 bg-white/20 hover:bg-white/40'),
              )}
              style={{
                left: `${left}%`,
                width: `${right - left}%`,
              }}
              onMouseEnter={() => setHoveredCommentId(c.id)}
              onMouseLeave={() => setHoveredCommentId(null)}
              onPointerDown={stopMouse}
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
            const width = Math.max(timeToPercent(Math.max(a, b)) - left, 0.4)
            return (
              <div
                className="absolute -inset-y-[1px] rounded-full border border-dashed border-white/80 bg-white/15 pointer-events-none"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            )
          })()}

        {/* Edit view: a red join where each cut came out */}
        {cuts?.map((r) => (
          <div
            key={r.start}
            className="absolute -inset-y-[3px] w-0.5 -translate-x-1/2 rounded-full bg-accent pointer-events-none"
            style={{ left: `${timeToPercent(r.start)}%` }}
          />
        ))}

        {/* Playhead thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-1 h-3.5 rounded-full bg-text-primary pointer-events-none z-10"
          style={{ left: `${playPercent}%`, transform: 'translateX(-50%) translateY(-50%)' }}
        />
      </div>

      {/* Comment markers row — below the progress bar. Every avatar shows;
          close ones overlap and the hovered one comes to the front. */}
      {pointMarkers.length > 0 && (
        <div className="relative w-full h-6 mt-0.5">
          {pointMarkers.map((c) => {
            const authorName = c.author?.name ?? c.guest_author?.name ?? 'Unknown'
            return (
              <CommentMarker
                key={c.id}
                comment={c}
                leftPercent={timeToPercent(c.timecode_start ?? 0)}
                authorName={authorName}
                avatarUrl={c.author?.avatar_url ?? null}
                // The frame preview wins while scrubbing over a range comment
                isHovered={hoveredCommentId === c.id && hoverTime === null}
                isFocused={focusedCommentId === c.id}
                onHover={() => {
                  setHoveredCommentId(c.id)
                  setHoverTime(null)
                }}
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
          className="absolute -top-2 z-30 w-40 pointer-events-none"
          style={{ left: hoverX, transform: 'translateX(-50%) translateY(-100%)' }}
        >
          {/* Frame preview */}
          {previewImage && (
            <div className="mb-1 rounded-md overflow-hidden border border-border-strong">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewImage} alt="" className="w-full object-contain bg-black" />
            </div>
          )}
          {/* Time label */}
          <div className="flex justify-center">
            <span className="bg-bg-elevated border border-border text-text-primary text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-md">
              {formatTimecode(hoverTime)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
