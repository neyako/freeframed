import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Comment } from '@/types'
import { ProgressBar } from '../progress-bar'

const comment = {
  id: 'c1',
  timecode_start: 10,
  timecode_end: null,
  resolved: false,
  body: 'note',
  author: { name: 'Reviewer' },
} as unknown as Comment

describe('ProgressBar', () => {
  it('scrubs with a touch drag that starts on a comment marker below the track', () => {
    const onSeek = vi.fn()
    const { container } = render(
      <ProgressBar currentTime={0} duration={100} comments={[comment]} onSeek={onSeek} />,
    )
    const track = container.querySelector('.touch-none')!.firstElementChild as HTMLDivElement
    track.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    const marker = container.querySelector('.w-5.h-5') as HTMLDivElement

    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20 })
    fireEvent.pointerMove(marker, { pointerId: 1, pointerType: 'touch', clientX: 100 })
    fireEvent.pointerUp(marker, { pointerId: 1, pointerType: 'touch', clientX: 150 })

    expect(onSeek.mock.calls.map(([time]) => time)).toEqual([10, 50, 75])
  })

  it('scrubbing takes focus out of the comment box so I / O reach the player', () => {
    const { container } = render(<ProgressBar currentTime={0} duration={100} onSeek={vi.fn()} />)
    const box = document.createElement('textarea')
    document.body.appendChild(box)
    box.focus()
    const track = container.querySelector('.touch-none')!.firstElementChild as HTMLDivElement
    track.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 50 })

    expect(document.activeElement).toBe(document.body)
    box.remove()
  })

  it('in the edit view, seeks to the source time past the cut', () => {
    const onSeek = vi.fn()
    const { container } = render(
      <ProgressBar currentTime={0} duration={40} cuts={[{ start: 10, end: 20 }]} onSeek={onSeek} />,
    )
    const track = container.querySelector('.touch-none')!.firstElementChild as HTMLDivElement
    track.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect

    // 30s edit across 300px: 150px is 0:15 of the edit, 0:25 of the source
    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 150 })

    expect(onSeek).toHaveBeenCalledWith(25)
  })
})
