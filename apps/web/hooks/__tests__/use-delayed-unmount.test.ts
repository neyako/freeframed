import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDelayedUnmount } from '../use-delayed-unmount'

describe('useDelayedUnmount', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('stays mounted through the close animation, then unmounts', () => {
    const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 150), {
      initialProps: { open: true },
    })
    expect(result.current.mounted).toBe(true)
    expect(result.current.state).toBe('open')

    // Close: mounted must persist while state flips to 'closed'.
    rerender({ open: false })
    expect(result.current.mounted).toBe(true)
    expect(result.current.state).toBe('closed')

    // Still mounted at exactly the animation duration: the unmount timer is
    // armed after the paint that starts the keyframes, not at commit, so it
    // deliberately lands a couple of frames late rather than cutting the fade.
    act(() => vi.advanceTimersByTime(150))
    expect(result.current.mounted).toBe(true)

    act(() => vi.advanceTimersByTime(100))
    expect(result.current.mounted).toBe(false)
  })

  // Regression: mounting with state still 'closed' rendered one frame matching
  // `data-[state=closed]`, running the exit animation backwards on open.
  it('never renders mounted-but-closed while opening', () => {
    const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 150), {
      initialProps: { open: false },
    })
    expect(result.current.mounted).toBe(false)

    rerender({ open: true })
    expect(result.current.mounted).toBe(true)
    expect(result.current.state).toBe('open')
  })

  it('cancels a pending unmount when reopened mid-close', () => {
    const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 150), {
      initialProps: { open: true },
    })

    rerender({ open: false })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.mounted).toBe(true)

    // Reopen before the timer fires; the stale unmount must not land.
    rerender({ open: true })
    expect(result.current.state).toBe('open')
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.mounted).toBe(true)
    expect(result.current.state).toBe('open')
  })
})
