import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ProgressTrack } from '../ui/progress'

describe('Progress components', () => {
  it('sets track fill width', () => {
    const { container } = render(<ProgressTrack value={42} />)
    const fill = container.querySelector('[style]')
    if (!(fill instanceof HTMLElement)) {
      throw new Error('Progress fill not found')
    }
    expect(fill).toHaveStyle({ width: '42%' })
  })

  it('uses amber fill for warning (processing phase)', () => {
    const { container } = render(<ProgressTrack value={30} warning />)
    const fill = container.querySelector('.bg-amber-500')
    if (!(fill instanceof HTMLElement)) {
      throw new Error('Warning fill not found')
    }
    expect(fill).toHaveStyle({ width: '30%' })
    // exactly one bg-* fill class — no cascade ambiguity with accent/text-primary
    expect(fill.className).not.toContain('bg-accent')
    expect(fill.className).not.toContain('bg-text-primary')
  })
})
