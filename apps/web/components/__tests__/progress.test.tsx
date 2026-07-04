import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ProgressTrack, SegmentedProgress } from '../ui/progress'

describe('Progress components', () => {
  it('renders filled segmented cells', () => {
    const { container } = render(<SegmentedProgress value={50} cells={12} />)
    expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(6)
  })

  it('renders accent cells when complete', () => {
    const { container } = render(<SegmentedProgress value={100} cells={12} />)
    expect(container.querySelectorAll('[data-accent="true"]').length).toBeGreaterThan(0)
  })

  it('sets track fill width', () => {
    const { container } = render(<ProgressTrack value={42} />)
    const fill = container.querySelector('[style]')
    if (!(fill instanceof HTMLElement)) {
      throw new Error('Progress fill not found')
    }
    expect(fill).toHaveStyle({ width: '42%' })
  })

  it('animates a fixed-width segment instead of tracking value when indeterminate', () => {
    const { container } = render(<ProgressTrack value={0} indeterminate />)
    const fill = container.querySelector('.animate-pulse')
    if (!(fill instanceof HTMLElement)) {
      throw new Error('Indeterminate fill not found')
    }
    expect(fill.style.width).toBe('')
    expect(fill.className).toContain('w-2/5')
  })
})
