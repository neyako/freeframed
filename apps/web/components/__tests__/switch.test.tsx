import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Switch } from '../ui/switch'

describe('Switch component', () => {
  it('renders unchecked state', () => {
    render(<Switch aria-label="Enable" />)
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked')
  })

  it('calls onCheckedChange when clicked', () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Enable" onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('does not call onCheckedChange when disabled', () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Enable" disabled onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('supports production row labels', () => {
    render(
      <div>
        <span>Enable watermark</span>
        <Switch aria-label="Enable watermark" />
      </div>,
    )
    expect(screen.getByRole('switch', { name: 'Enable watermark' })).toBeInTheDocument()
  })
})
