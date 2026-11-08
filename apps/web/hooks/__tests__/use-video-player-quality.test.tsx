import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { savedBandwidth, saveBandwidth } from '@/lib/hls-bandwidth'
import { useVideoPlayer, type UseVideoPlayerReturn } from '../use-video-player'

const hls = vi.hoisted(() => {
  const instances: Array<{
    config: Record<string, unknown>
    currentLevel: number
    bandwidthEstimate: number
    emit: (event: string, data: unknown) => void
  }> = []
  const Events = {
    MANIFEST_PARSED: 'manifestParsed',
    ERROR: 'error',
    LEVEL_SWITCHED: 'levelSwitched',
    FRAG_BUFFERED: 'fragBuffered',
  }
  return { Events, instances }
})

vi.mock('hls.js', () => {
  const { Events, instances } = hls
  class FakeHls {
    static Events = Events
    static isSupported = () => true
    currentLevel = -1
    bandwidthEstimate = 0
    private handlers = new Map<string, (event: string, data: unknown) => void>()
    constructor(public config: Record<string, unknown>) {
      instances.push(this as never)
    }
    on(event: string, cb: (event: string, data: unknown) => void) {
      this.handlers.set(event, cb)
    }
    emit(event: string, data: unknown) {
      this.handlers.get(event)?.(event, data)
    }
    loadSource() {}
    attachMedia() {}
    destroy() {}
    startLoad() {}
  }
  return { default: FakeHls }
})

let player: UseVideoPlayerReturn

function Harness() {
  player = useVideoPlayer('http://example.test/master.m3u8')
  return <video ref={player.videoRef} />
}

const levels = [
  { height: 360, width: 640, bitrate: 800_000 },
  { height: 720, width: 1280, bitrate: 2_000_000 },
  { height: 1080, width: 1920, bitrate: 5_000_000 },
]

beforeEach(() => {
  hls.instances.length = 0
  window.localStorage.clear()
  vi.stubGlobal('MediaSource', class {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('quality selection', () => {
  it('stays on Auto while hls.js switches rungs by itself', () => {
    render(<Harness />)
    act(() => hls.instances[0].emit(hls.Events.MANIFEST_PARSED, { levels }))
    act(() => hls.instances[0].emit(hls.Events.LEVEL_SWITCHED, { level: 2 }))

    expect(player.selectedQuality).toBe(-1) // still Auto
    expect(player.currentQuality).toBe(2) // 1080p is what is playing
  })

  it('remembers a rung the viewer picked, and goes back to Auto when asked', () => {
    render(<Harness />)
    act(() => hls.instances[0].emit(hls.Events.MANIFEST_PARSED, { levels }))

    act(() => player.setQuality(1))
    expect(player.selectedQuality).toBe(1)
    expect(hls.instances[0].currentLevel).toBe(1)

    act(() => player.setQuality(-1))
    expect(player.selectedQuality).toBe(-1)
  })
})

describe('starting quality', () => {
  const frag = (overrides: Record<string, unknown> = {}) => ({
    frag: { type: 'main', sn: 3, stats: { aborted: false }, ...overrides },
  })

  it('starts Auto from the bandwidth measured last time', () => {
    saveBandwidth(15_000_000)
    render(<Harness />)

    expect(hls.instances[0].config.abrEwmaDefaultEstimate).toBe(15_000_000)
  })

  it('leaves a first-time viewer on hls.js\'s own first guess', () => {
    render(<Harness />)

    expect(hls.instances[0].config).not.toHaveProperty('abrEwmaDefaultEstimate')
  })

  it('saves the estimate after each buffered video segment, and only those', () => {
    render(<Harness />)
    const instance = hls.instances[0]
    instance.bandwidthEstimate = 18_000_000

    act(() => {
      instance.emit(hls.Events.FRAG_BUFFERED, frag({ type: 'audio' }))
      instance.emit(hls.Events.FRAG_BUFFERED, frag({ sn: 'initSegment' }))
      instance.emit(hls.Events.FRAG_BUFFERED, frag({ stats: { aborted: true } }))
    })
    expect(savedBandwidth()).toBeUndefined()

    act(() => instance.emit(hls.Events.FRAG_BUFFERED, frag()))
    expect(savedBandwidth()).toBe(18_000_000)
  })
})
