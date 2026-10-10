import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VideoPlayer } from '../video-player'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(() => new Promise(() => {})) } }))
vi.mock('../review-provider', () => ({ useReview: () => ({ registerPauseHandler: vi.fn() }) }))
vi.mock('@/hooks/use-video-player', () => ({
  useVideoPlayer: () => ({
    videoRef: { current: null },
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
    pause: vi.fn(),
    togglePlay: vi.fn(),
    seek: vi.fn(),
    setPlaybackRate: vi.fn(),
    setQuality: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    toggleFullscreen: vi.fn(),
  }),
}))

describe('VideoPlayer transport', () => {
  it('a mouse click on Play leaves focus in neither the comment box nor the button', () => {
    render(<VideoPlayer assetId="a1" />)
    const box = document.createElement('textarea')
    document.body.appendChild(box)
    box.focus()

    const pressed = !fireEvent.mouseDown(screen.getByRole('button', { name: 'Play' }))

    expect(pressed).toBe(true) // default prevented: the button doesn't take focus
    expect(document.activeElement).toBe(document.body)
    box.remove()
  })

  it('a popover trigger keeps normal focus, so Enter stays with its open popover', () => {
    const { container } = render(<VideoPlayer assetId="a1" />)
    const trigger = container.querySelector('button[aria-expanded]') as HTMLButtonElement

    expect(fireEvent.mouseDown(trigger)).toBe(true) // not prevented
  })
})
