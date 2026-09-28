import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '../shared/empty-state'

describe('EmptyState component', () => {
  it('renders with title', () => {
    render(<EmptyState title="No assets found" />)
    expect(screen.getByText('No assets found')).toBeInTheDocument()
  })

  it('renders action button when action is provided', () => {
    const handleClick = vi.fn()
    render(
      <EmptyState
        title="No items"
        action={{ label: 'Create Item', onClick: handleClick }}
      />,
    )
    const button = screen.getByRole('button', { name: 'Create Item' })
    expect(button).toBeInTheDocument()
  })

  it('action button click fires handler', () => {
    const handleClick = vi.fn()
    render(
      <EmptyState
        title="No items"
        action={{ label: 'Add New', onClick: handleClick }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add New' }))
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it('does not render action button when no action provided', () => {
    render(<EmptyState title="Empty" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Test" className="my-custom" />)
    expect(container.firstChild).toHaveClass('my-custom')
  })
})
