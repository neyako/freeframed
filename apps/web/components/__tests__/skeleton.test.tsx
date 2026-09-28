import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SkeletonGrid } from '../shared/skeleton'

describe('Skeleton components', () => {
  describe('SkeletonGrid', () => {
    it('renders default 6 skeleton cards', () => {
      const { container } = render(<SkeletonGrid />)
      // Each card has an aspect-video skeleton inside
      const cards = container.querySelectorAll('[class*="aspect-video"]')
      expect(cards).toHaveLength(6)
    })

    it('renders N skeleton cards when count is specified', () => {
      const { container } = render(<SkeletonGrid count={3} />)
      const cards = container.querySelectorAll('[class*="aspect-video"]')
      expect(cards).toHaveLength(3)
    })

    it('renders 1 skeleton card', () => {
      const { container } = render(<SkeletonGrid count={1} />)
      const cards = container.querySelectorAll('[class*="aspect-video"]')
      expect(cards).toHaveLength(1)
    })
  })
})
