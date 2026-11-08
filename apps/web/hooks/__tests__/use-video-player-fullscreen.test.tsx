import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVideoPlayer } from '../use-video-player'

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

function setup() {
  const hook = renderHook(() => useVideoPlayer(null))
  const video: FullscreenVideo = document.createElement('video')
  ;(hook.result.current.videoRef as { current: HTMLVideoElement | null }).current = video
  return { hook, video, container: document.createElement('div') }
}

afterEach(() => {
  Reflect.deleteProperty(document, 'fullscreenElement')
  Reflect.deleteProperty(document, 'exitFullscreen')
})

describe('toggleFullscreen', () => {
  it('uses the element API where there is one', () => {
    const { hook, container } = setup()
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    ;(container as HTMLElement & { requestFullscreen: () => Promise<void> }).requestFullscreen = requestFullscreen

    act(() => hook.result.current.toggleFullscreen(container))

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('falls back to the video player on an iPhone, which has no element fullscreen', () => {
    const { hook, video, container } = setup()
    video.webkitEnterFullscreen = vi.fn()

    expect(() => act(() => hook.result.current.toggleFullscreen(container))).not.toThrow()

    expect(video.webkitEnterFullscreen).toHaveBeenCalledTimes(1)
  })

  it('exits through the document when already fullscreen', () => {
    const { hook, container } = setup()
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'fullscreenElement', { value: container, configurable: true })
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true })

    act(() => hook.result.current.toggleFullscreen(container))

    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })
})
