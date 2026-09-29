import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProgressBar } from '../progress-bar'

describe('ProgressBar', () => {
  it('scrubs with a touch drag', () => {
    const onSeek = vi.fn()
    const { container } = render(<ProgressBar currentTime={0} duration={100} onSeek={onSeek} />)
    const track = container.querySelector('.touch-none') as HTMLDivElement
    track.setPointerCapture = vi.fn()
    track.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20 })
    fireEvent.pointerMove(track, { pointerId: 1, pointerType: 'touch', clientX: 100 })
    fireEvent.pointerUp(track, { pointerId: 1, pointerType: 'touch', clientX: 150 })

    expect(onSeek.mock.calls.map(([time]) => time)).toEqual([10, 50, 75])
  })
})
