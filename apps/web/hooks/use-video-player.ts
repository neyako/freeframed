'use client'

import Hls, { type Level } from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useReviewStore } from '@/stores/review-store'
import { hlsStartConfig, saveBandwidth } from '@/lib/hls-bandwidth'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QualityLevel {
  index: number
  height: number
  bitrate: number
  label: string
}

export interface VideoPlayerControls {
  play: () => void
  pause: () => void
  togglePlay: () => void
  seek: (time: number) => void
  setPlaybackRate: (rate: number) => void
  setQuality: (levelIndex: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  toggleFullscreen: (containerEl: HTMLElement) => void
}

export interface VideoPlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  buffered: number
  volume: number
  isMuted: boolean
  playbackRate: number
  qualityLevels: QualityLevel[]
  /** The rendition playing now (-1 until hls.js reports one). */
  currentQuality: number
  /** What the viewer picked: -1 is Auto, which stays Auto while hls.js switches. */
  selectedQuality: number
  isLoading: boolean
  isFullscreen: boolean
  error: string | null
}

export interface UseVideoPlayerReturn extends VideoPlayerControls, VideoPlayerState {
  videoRef: React.RefObject<HTMLVideoElement>
  hlsRef: React.RefObject<Hls | null>
}

// hls.js on ManagedMediaSource (the only MSE iPhone Safari has) lets iOS pause
// fetching, and after a seek into an unbuffered range it can stay paused: a
// frozen frame while the timecode moves. Use classic MSE where it exists
// (with preferManagedMediaSource: false), otherwise Safari's native HLS.
export function canUseHlsJs(): boolean {
  return typeof MediaSource !== 'undefined' && Hls.isSupported()
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVideoPlayer(src: string | null): UseVideoPlayerReturn {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { setPlayheadTime, seekTarget, setActiveAnnotation } = useReviewStore()

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([])
  const [currentQuality, setCurrentQuality] = useState(-1) // -1 = no rung reported yet
  const [selectedQuality, setSelectedQuality] = useState(-1) // -1 = auto
  const [isLoading, setIsLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // True while the CSS fill stands in for fullscreen (iPhone)
  const pseudoFullscreenRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  // Sync playhead to store at ~4fps to avoid excessive re-renders
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      const video = videoRef.current
      if (video && !video.paused) {
        setPlayheadTime(video.currentTime)
      }
    }, 250)
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    }
  }, [setPlayheadTime])

  // React to external seek requests (e.g. clicking comment timecode)
  useEffect(() => {
    if (!seekTarget) return
    const video = videoRef.current
    if (!video) return
    const dur = video.duration
    // Allow seek even if duration isn't fully resolved yet (NaN/0)
    if (dur && Number.isFinite(dur)) {
      const clamped = Math.max(0, Math.min(seekTarget.time, dur))
      video.currentTime = clamped
      setCurrentTime(clamped)
      if (seekTarget.pause) {
        video.pause()
        setIsPlaying(false)
      }
    } else {
      // Queue seek for after metadata loads
      const onLoaded = () => {
        const d = video.duration
        if (d && Number.isFinite(d)) {
          const clamped = Math.max(0, Math.min(seekTarget.time, d))
          video.currentTime = clamped
          setCurrentTime(clamped)
          if (seekTarget.pause) {
            video.pause()
            setIsPlaying(false)
          }
        }
        video.removeEventListener('loadedmetadata', onLoaded)
      }
      video.addEventListener('loadedmetadata', onLoaded)
      return () => video.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [seekTarget])

  // Fullscreen state. Element fullscreen reports through the document, standard
  // or Safari-prefixed (iPadOS, desktop). An iPhone uses a CSS fill (see
  // toggleFullscreen); the native-player events below still cover a user who
  // opens Safari's own player.
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null }
    const readDoc = () => setIsFullscreen(!!(document.fullscreenElement || doc.webkitFullscreenElement))
    document.addEventListener('fullscreenchange', readDoc)
    document.addEventListener('webkitfullscreenchange', readDoc)
    return () => {
      document.removeEventListener('fullscreenchange', readDoc)
      document.removeEventListener('webkitfullscreenchange', readDoc)
    }
  }, [])

  // HLS + video element setup
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setError(null)
    setIsLoading(true)

    const onLoadedMetadata = () => {
      setDuration(video.duration)
      setIsLoading(false)
    }

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      // Update buffered end
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1))
      }
    }

    const onPlay = () => { setIsPlaying(true); setActiveAnnotation(null) }
    const onPause = () => setIsPlaying(false)
    const onWaiting = () => setIsLoading(true)
    const onCanPlay = () => setIsLoading(false)
    const onVolumeChange = () => {
      setVolumeState(video.volume)
      setIsMuted(video.muted)
    }
    const onEnded = () => {
      setIsPlaying(false)
      setPlayheadTime(video.duration)
    }
    const onError = () => {
      setIsLoading(false)
      setError('Video playback error')
    }
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1))
      }
    }
    const onEnterNativeFullscreen = () => setIsFullscreen(true)
    const onLeaveNativeFullscreen = () => setIsFullscreen(false)

    video.addEventListener('webkitbeginfullscreen', onEnterNativeFullscreen)
    video.addEventListener('webkitendfullscreen', onLeaveNativeFullscreen)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    video.addEventListener('progress', onProgress)

    const isHlsSource = src.includes('.m3u8')

    if (isHlsSource && canUseHlsJs()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        preferManagedMediaSource: false,
        ...hlsStartConfig(),
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const levels: QualityLevel[] = data.levels.map((level: Level, index: number) => ({
          index,
          height: level.height,
          bitrate: level.bitrate,
          // Label by the short edge so vertical renditions read 1080p, not 1920p
          label: level.height
            ? `${Math.min(level.width || level.height, level.height)}p`
            : `${Math.round(level.bitrate / 1000)}kbps`,
        }))
        setQualityLevels(levels)
        setCurrentQuality(-1) // wait for the first active rung
        setSelectedQuality(-1) // every new manifest starts on auto
        setIsLoading(false)
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError(`HLS error: ${data.type}`)
          setIsLoading(false)
        }
      })

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentQuality(data.level)
      })

      // Remember the measured bandwidth so the next video starts on the right
      // rung. hls.js samples on the same fragment in a listener registered
      // before this one, so the estimate already includes it.
      hls.on(Hls.Events.FRAG_BUFFERED, (_event, { frag }) => {
        if (frag.type !== 'main' || frag.sn === 'initSegment' || frag.stats.aborted) return
        saveBandwidth(hls.bandwidthEstimate)
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src
    } else {
      // Direct URL (mp4, mp3, etc.)
      video.src = src
    }

    return () => {
      video.removeEventListener('webkitbeginfullscreen', onEnterNativeFullscreen)
      video.removeEventListener('webkitendfullscreen', onLeaveNativeFullscreen)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      video.removeEventListener('progress', onProgress)

      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      } else {
        // Native playback (Safari HLS / direct URL): stop the old source so it
        // doesn't keep playing while the next one loads
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [src, setPlayheadTime])

  // ─── Controls ───────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {
      // Autoplay may be blocked; ignore
    })
  }, [])

  const pause = useCallback(() => {
    videoRef.current?.pause()
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    // iOS Safari can report a NaN duration mid-session; clamping to 0 then
    // sent every seek back to the start until a reload
    const clamped = Math.max(0, Math.min(time, video.duration || Infinity))
    video.currentTime = clamped
    setCurrentTime(clamped)
    setPlayheadTime(clamped)
  }, [setPlayheadTime])

  const setPlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
    setPlaybackRateState(rate)
  }, [])

  const setQuality = useCallback((levelIndex: number) => {
    const hls = hlsRef.current
    if (!hls) return
    hls.currentLevel = levelIndex // -1 = auto
    setSelectedQuality(levelIndex)
  }, [])

  const setVolume = useCallback((vol: number) => {
    const video = videoRef.current
    if (!video) return
    const clamped = Math.max(0, Math.min(1, vol))
    video.volume = clamped
    video.muted = clamped === 0
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
  }, [])

  // An iPhone has no element fullscreen: Element.requestFullscreen is undefined
  // there, so this used to throw "not a function" and the button did nothing.
  // Safari on iPadOS and desktop has the prefixed element API; an iPhone gets a
  // CSS fill instead. Try them in that order.
  const toggleFullscreen = useCallback((containerEl: HTMLElement) => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => Promise<void> | void
    }
    const el = containerEl as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

    if (pseudoFullscreenRef.current) {
      pseudoFullscreenRef.current = false
      setIsFullscreen(false)
      return
    }
    const active = !!(document.fullscreenElement || doc.webkitFullscreenElement)
    if (!active) {
      if (typeof el.requestFullscreen === 'function') {
        void Promise.resolve(el.requestFullscreen()).catch(() => {})
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        void Promise.resolve(el.webkitRequestFullscreen()).catch(() => {})
      } else {
        // iPhone: fill the viewport with CSS (the container goes fixed
        // inset-0) rather than the native video player, which would hide our
        // controls, comment markers and annotations
        pseudoFullscreenRef.current = true
        setIsFullscreen(true)
      }
      return
    }
    if (typeof document.exitFullscreen === 'function') {
      void Promise.resolve(document.exitFullscreen()).catch(() => {})
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      void Promise.resolve(doc.webkitExitFullscreen()).catch(() => {})
    }
  }, [])

  return {
    videoRef,
    hlsRef,
    // state
    isPlaying,
    currentTime,
    duration,
    buffered,
    volume,
    isMuted,
    playbackRate,
    qualityLevels,
    currentQuality,
    selectedQuality,
    isLoading,
    isFullscreen,
    error,
    // controls
    play,
    pause,
    togglePlay,
    seek,
    setPlaybackRate,
    setQuality,
    setVolume,
    toggleMute,
    toggleFullscreen,
  }
}
