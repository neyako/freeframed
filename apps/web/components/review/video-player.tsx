"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ChevronUp,
  Check,
  Repeat,
  RotateCcw,
  RotateCw,
  Download,
} from "lucide-react";
import { cn, formatTime, formatTimecode, formatFrames } from "@/lib/utils";
import { api } from "@/lib/api";
import { useReviewStore, type TimeFormat } from "@/stores/review-store";
import { useVideoPlayer } from "@/hooks/use-video-player";
import { resolveStreamUrl } from "@/components/share/share-stream";
import { useReview } from "./review-provider";
import { ProgressBar } from "./progress-bar";
import type { Comment } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamUrlResponse {
  url: string;
}

interface VideoPlayerProps {
  assetId: string;
  comments?: Comment[];
  overlay?: React.ReactNode;
  className?: string;
  /** Pre-fetched stream URL (for share mode — skips authenticated API call) */
  initialStreamUrl?: string | null;
  poster?: string | null;
  /** When set, a download button appears in the transport bar. Gate by permission at the call site. */
  onDownload?: () => void;
}

// ─── Video frame constraint ──────────────────────────────────────────────────

/**
 * Wraps children so they are positioned exactly over the visible video frame,
 * excluding the black letterbox bars created by object-contain.
 */
function VideoFrameConstraint({
  videoRef,
  children,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const calc = () => {
      const container = video.parentElement;
      if (!container) return;

      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (!vw || !vh) {
        // Video metadata not loaded yet — fill container
        setStyle({ position: "absolute", inset: 0 });
        return;
      }

      const containerAspect = cw / ch;
      const videoAspect = vw / vh;

      let renderW: number, renderH: number, offsetX: number, offsetY: number;

      if (videoAspect > containerAspect) {
        // Video wider than container — letterbox top/bottom
        renderW = cw;
        renderH = cw / videoAspect;
        offsetX = 0;
        offsetY = (ch - renderH) / 2;
      } else {
        // Video taller than container — letterbox left/right
        renderH = ch;
        renderW = ch * videoAspect;
        offsetX = (cw - renderW) / 2;
        offsetY = 0;
      }

      setStyle({
        position: "absolute",
        left: offsetX,
        top: offsetY,
        width: renderW,
        height: renderH,
      });
    };

    calc();
    video.addEventListener("loadedmetadata", calc);
    video.addEventListener("resize", calc);

    const ro = new ResizeObserver(calc);
    if (video.parentElement) ro.observe(video.parentElement);

    return () => {
      video.removeEventListener("loadedmetadata", calc);
      video.removeEventListener("resize", calc);
      ro.disconnect();
    };
  }, [videoRef]);

  return (
    <div ref={wrapperRef} style={style} className="overflow-hidden">
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [1, 1.25, 1.5, 2, 4, 8, 16] as const;

export function VideoPlayer({
  assetId,
  comments = [],
  overlay,
  className,
  initialStreamUrl,
  poster,
  onDownload,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);

  const { isDrawingMode, timeFormat, setTimeFormat, setPlayheadTime } =
    useReviewStore();
  const { registerPauseHandler } = useReview();
  const [timeFormatOpen, setTimeFormatOpen] = useState(false);
  const timeFormatRef = useRef<HTMLDivElement>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const qualityRef = useRef<HTMLDivElement>(null);

  // Close time format dropdown on outside click
  useEffect(() => {
    if (!timeFormatOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        timeFormatRef.current &&
        !timeFormatRef.current.contains(e.target as Node)
      )
        setTimeFormatOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [timeFormatOpen]);

  useEffect(() => {
    if (!qualityOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (qualityRef.current && !qualityRef.current.contains(e.target as Node))
        setQualityOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [qualityOpen]);

  function displayTime(seconds: number): string {
    switch (timeFormat) {
      case "frames":
        return formatFrames(seconds);
      case "standard":
        return formatTime(seconds);
      case "timecode":
        return formatTimecode(seconds);
      default:
        return formatTimecode(seconds);
    }
  }

  // Load the stream URL — reset immediately on asset change so the old video
  // doesn't keep playing while the new URL is being fetched.
  useEffect(() => {
    setStreamUrl(null);
    if (initialStreamUrl) {
      setStreamUrl(resolveStreamUrl(initialStreamUrl));
      return;
    }
    api
      .get<StreamUrlResponse>(`/assets/${assetId}/stream`)
      .then((data) => {
        // HLS proxy returns relative paths — prepend API URL
        setStreamUrl(resolveStreamUrl(data.url));
      })
      .catch(() => {
        /* stream URL errors handled by player error state */
      });
  }, [assetId, initialStreamUrl]);

  const player = useVideoPlayer(streamUrl);

  const {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    buffered,
    volume,
    isMuted,
    playbackRate,
    qualityLevels,
    currentQuality,
    isLoading,
    isFullscreen,
    error,
    pause,
    togglePlay,
    seek,
    setPlaybackRate,
    setQuality,
    setVolume,
    toggleMute,
    toggleFullscreen,
  } = player;

  // Register pause handler with review provider
  useEffect(() => {
    registerPauseHandler(pause);
  }, [registerPauseHandler, pause]);

  // Sync video currentTime to review store so comment input shows same timecode
  const lastSyncRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastSyncRef.current > 100) {
      setPlayheadTime(currentTime);
      lastSyncRef.current = now;
    }
  }, [currentTime, setPlayheadTime]);

  const handleSpeedCycle = useCallback(() => {
    const idx = SPEED_OPTIONS.indexOf(
      playbackRate as (typeof SPEED_OPTIONS)[number],
    );
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
  }, [playbackRate, setPlaybackRate]);

  // Keyboard shortcuts
  useEffect(() => {
    const stepFrame = (direction: 1 | -1) => {
      const video = videoRef.current;
      if (!video) return;
      pause();
      const fps =
        useReviewStore.getState().currentVersion?.files?.find((f) => f.fps)
          ?.fps ?? 24;
      // Read time off the element — the state value lags behind timeupdate
      seek(video.currentTime + direction / fps);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        isDrawingMode
      ) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(currentTime + 5);
          break;
        case "KeyJ":
          seek(currentTime - 10);
          break;
        case "KeyK":
          togglePlay();
          break;
        case "KeyL":
          handleSpeedCycle();
          break;
        case "Comma":
          stepFrame(-1);
          break;
        case "Period":
          stepFrame(1);
          break;
        case "KeyI":
          useReviewStore.getState().setRangeStart(currentTime);
          break;
        case "KeyO":
          useReviewStore.getState().setRangeEnd(currentTime);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, seek, currentTime, isDrawingMode, handleSpeedCycle, pause, videoRef]);

  const handleContainerClick = useCallback(() => {
    if (holdSuppressClickRef.current) {
      holdSuppressClickRef.current = false;
      return;
    }
    if (!isDrawingMode) {
      togglePlay();
    }
  }, [togglePlay, isDrawingMode]);

  // Hold-to-fast: press-and-hold the video area plays at 2x (TikTok/YouTube style)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdPrevRateRef = useRef(1);
  const holdActiveRef = useRef(false);
  const holdSuppressClickRef = useRef(false);
  const [isHoldingFast, setIsHoldingFast] = useState(false);

  const startHold = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isDrawingMode) return;
      // Keep receiving pointerup even if the pointer leaves the element
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* unsupported pointer capture — hold still works via pointerup on element */
      }
      holdTimerRef.current = setTimeout(() => {
        holdPrevRateRef.current = playbackRate;
        holdActiveRef.current = true;
        setPlaybackRate(2);
        setIsHoldingFast(true);
        holdSuppressClickRef.current = true;
      }, 500);
    },
    [isDrawingMode, playbackRate, setPlaybackRate],
  );

  const endHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      setPlaybackRate(holdPrevRateRef.current);
      setIsHoldingFast(false);
    }
  }, [setPlaybackRate]);

  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
  }, []);

  // While holding, hls.js recovery or the browser can reset the native rate — pin it back
  useEffect(() => {
    if (!isHoldingFast) return;
    const video = videoRef.current;
    if (!video) return;
    const enforce = () => {
      if (holdActiveRef.current && video.playbackRate !== 2) {
        video.playbackRate = 2;
      }
    };
    video.addEventListener("ratechange", enforce);
    return () => video.removeEventListener("ratechange", enforce);
  }, [isHoldingFast, videoRef]);

  const handleFullscreen = useCallback(() => {
    if (containerRef.current) {
      toggleFullscreen(containerRef.current);
    }
  }, [toggleFullscreen]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col h-full w-full",
        isFullscreen && "fixed inset-0 z-50",
        className,
      )}
    >
      {/* Video area — fills available space, object-contain preserves aspect ratio with letterbox */}
      <div
        className="flex-1 relative min-h-0 bg-black overflow-hidden cursor-pointer select-none touch-none"
        onClick={handleContainerClick}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          className={cn(
            "absolute inset-0 w-full h-full object-contain",
            isDrawingMode ? "pointer-events-none" : "",
          )}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
          loop={loop}
        />

        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Hold-to-fast indicator */}
        {isHoldingFast && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded bg-black/70 px-2.5 py-1 font-mono text-xs text-white">
            2x ››
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-status-error text-sm">{error}</p>
          </div>
        )}

        {/* Overlay slot (annotation canvas / overlay) — constrained to video frame */}
        {overlay && (
          <VideoFrameConstraint videoRef={videoRef}>
            {overlay}
          </VideoFrameConstraint>
        )}
      </div>

      {/* Progress bar */}
      <div className="shrink-0 bg-bg-primary">
        <ProgressBar
          currentTime={currentTime}
          duration={duration}
          buffered={buffered}
          comments={comments}
          streamUrl={streamUrl}
          onSeek={seek}
        />
      </div>

      {/* Bottom transport bar (matches audio player style) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-12 px-2 sm:px-4 bg-bg-secondary border-t border-border shrink-0">
        {/* Left: Play, Loop, Speed, Volume */}
        <div className="flex items-center gap-1 sm:gap-2 justify-self-start">
          <button
            onClick={() => seek(currentTime - 5)}
            className="md:hidden flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
            aria-label="Back 5 seconds"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <button
            onClick={togglePlay}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-bg-tertiary text-text-primary hover:border-border-strong transition-colors"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>

          <button
            onClick={() => seek(currentTime + 5)}
            className="md:hidden flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
            aria-label="Forward 5 seconds"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          <button
            onClick={() => setLoop((p) => !p)}
            className={cn(
              "hidden md:flex h-7 w-7 items-center justify-center rounded transition-colors",
              loop
                ? "text-accent"
                : "text-text-tertiary hover:text-text-primary",
            )}
            aria-label="Loop"
          >
            <Repeat className="h-4 w-4" />
          </button>

          <button
            onClick={handleSpeedCycle}
            className="hidden md:block font-mono text-xs text-text-secondary hover:text-text-primary"
            aria-label="Playback speed"
          >
            {playbackRate}x
          </button>

          <button
            onClick={toggleMute}
            className="hidden md:flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Center: Timecode display with format picker */}
        <div className="relative justify-self-center" ref={timeFormatRef}>
          <button
            onClick={() => setTimeFormatOpen((p) => !p)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-3.5 py-1 hover:border-border-strong transition-colors"
          >
            <span className="font-dot text-xs sm:text-[15px] font-bold text-text-primary tracking-[0.02em]">
              {timeFormat === "timecode" ? (
                displayTime(currentTime)
              ) : (
                <>
                  {displayTime(currentTime)}{" "}
                  <span className="text-text-tertiary">/</span>{" "}
                  {displayTime(duration)}
                </>
              )}
            </span>
            <ChevronUp
              className={cn(
                "h-3 w-3 text-text-tertiary transition-transform",
                timeFormatOpen && "rotate-180",
              )}
            />
          </button>
          {timeFormatOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-48 rounded border border-border bg-bg-elevated py-1.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 text-[11px] text-text-tertiary uppercase font-mono tracking-[0.16em]">
                Time Format
              </div>
              {(
                [
                  { id: "frames" as TimeFormat, label: "Frames" },
                  { id: "standard" as TimeFormat, label: "Standard" },
                  { id: "timecode" as TimeFormat, label: "Timecode" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors",
                    timeFormat === item.id
                      ? "text-text-primary"
                      : "text-text-secondary hover:bg-bg-hover",
                  )}
                  onClick={() => {
                    setTimeFormat(item.id);
                    setTimeFormatOpen(false);
                  }}
                >
                  {item.label}
                  {timeFormat === item.id && (
                    <Check className="h-4 w-4 text-accent" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Quality, Fullscreen */}
        <div className="flex items-center gap-1 sm:gap-2 justify-self-end">
          {/* Quality selector */}
          {qualityLevels.length > 0 && (
            <div className="relative shrink-0" ref={qualityRef}>
              <button
                onClick={() => setQualityOpen((p) => !p)}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
                aria-label="Quality"
              >
                {currentQuality === -1
                  ? "Auto"
                  : (qualityLevels.find((l) => l.index === currentQuality)
                      ?.label ?? "Auto")}
                <ChevronUp
                  className={cn(
                    "h-3 w-3 text-text-tertiary transition-transform",
                    qualityOpen && "rotate-180",
                  )}
                />
              </button>
              {qualityOpen && (
                <div className="absolute bottom-full right-0 mb-2 z-50 w-36 rounded border border-border bg-bg-elevated py-1.5 animate-in fade-in zoom-in-95 duration-100">
                  <button
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors",
                      currentQuality === -1
                        ? "text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover",
                    )}
                    onClick={() => {
                      setQuality(-1);
                      setQualityOpen(false);
                    }}
                  >
                    Auto{" "}
                    {currentQuality === -1 && (
                      <Check className="h-4 w-4 text-accent" />
                    )}
                  </button>
                  {qualityLevels.map((level) => (
                    <button
                      key={level.index}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors",
                        currentQuality === level.index
                          ? "text-text-primary"
                          : "text-text-secondary hover:bg-bg-hover",
                      )}
                      onClick={() => {
                        setQuality(level.index);
                        setQualityOpen(false);
                      }}
                    >
                      {level.label}{" "}
                      {currentQuality === level.index && (
                        <Check className="h-4 w-4 text-accent" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Download (only when caller grants permission) */}
          {onDownload && (
            <button
              onClick={onDownload}
              className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
              aria-label="Download"
            >
              <Download className="h-4 w-4" />
            </button>
          )}

          {/* Fullscreen */}
          <button
            onClick={handleFullscreen}
            className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
