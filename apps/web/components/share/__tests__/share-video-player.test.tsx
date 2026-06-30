import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UseVideoPlayerReturn } from '@/hooks/use-video-player'
import { ShareVideoPlayer, resolveStreamUrl } from '../share-video-player'

const useVideoPlayerMock = vi.hoisted(() =>
  vi.fn((_src: string | null): UseVideoPlayerReturn => ({
    videoRef: { current: null },
    hlsRef: { current: null },
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    isMuted: false,
    playbackRate: 1,
    qualityLevels: [],
    currentQuality: -1,
    isLoading: false,
    isFullscreen: false,
    error: null,
    play: vi.fn(),
    pause: vi.fn(),
    togglePlay: vi.fn(),
    seek: vi.fn(),
    setPlaybackRate: vi.fn(),
    setQuality: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    toggleFullscreen: vi.fn(),
  })),
)

vi.mock('@/hooks/use-video-player', () => ({
  useVideoPlayer: useVideoPlayerMock,
}))

describe('ShareVideoPlayer', () => {
  it('prefixes relative HLS URLs with the API origin', () => {
    expect(resolveStreamUrl('/stream/hls/master.m3u8?token=guest')).toBe(
      'http://localhost:8000/stream/hls/master.m3u8?token=guest',
    )
  })

  it('leaves absolute stream URLs unchanged', () => {
    const absoluteUrl = 'https://cdn.example.test/video/master.m3u8'

    expect(resolveStreamUrl(absoluteUrl)).toBe(absoluteUrl)
  })

  it('renders native video controls and passes the resolved URL to the player hook', () => {
    render(<ShareVideoPlayer src="/stream/hls/master.m3u8?token=guest" />)

    const video = document.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(useVideoPlayerMock).toHaveBeenCalledWith(
      'http://localhost:8000/stream/hls/master.m3u8?token=guest',
    )
  })

  it('does not show the unavailable overlay before the hook reports an error', () => {
    render(<ShareVideoPlayer src="https://cdn.example.test/video/master.m3u8" />)

    expect(screen.queryByText('Video unavailable')).not.toBeInTheDocument()
  })
})
