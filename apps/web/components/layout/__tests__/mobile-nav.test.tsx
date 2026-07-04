import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MobileNav } from '../mobile-nav'

const mocks = vi.hoisted(() => ({
  togglePanel: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
}))

vi.mock('@/stores/upload-store', () => ({
  useUploadStore: () => ({
    togglePanel: mocks.togglePanel,
  }),
}))

describe('MobileNav', () => {
  beforeEach(() => {
    mocks.togglePanel.mockClear()
  })

  it('renders the bottom navigation tabs', () => {
    render(<MobileNav onSearchOpen={vi.fn()} />)

    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Uploads')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
  })

  it('opens search from the Search tab', () => {
    const onSearchOpen = vi.fn()

    render(<MobileNav onSearchOpen={onSearchOpen} />)

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSearchOpen).toHaveBeenCalledOnce()
  })
})
