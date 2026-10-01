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
})
