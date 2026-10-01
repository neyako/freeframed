import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVideoPlayer } from '../use-video-player'

describe('useVideoPlayer', () => {
  it('seeks back 5s when the browser reports no duration', () => {
    const { result } = renderHook(() => useVideoPlayer(null))
    const video = document.createElement('video')
    Object.defineProperty(video, 'duration', { value: NaN })
    let time = 30
    Object.defineProperty(video, 'currentTime', { get: () => time, set: (t: number) => { time = t } })
    ;(result.current.videoRef as { current: HTMLVideoElement }).current = video

    act(() => result.current.seek(25))

    expect(time).toBe(25)
  })
})
