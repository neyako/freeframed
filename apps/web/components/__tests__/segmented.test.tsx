import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Segmented } from '../ui/segmented'

describe('Segmented component', () => {
  const options = [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' },
  ]

  it('renders all options', () => {
    render(<Segmented options={options} value="grid" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Grid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument()
  })

  it('marks active option', () => {
    render(<Segmented options={options} value="grid" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('data-active', 'true')
  })

  it('calls onChange with selected value', () => {
    const onChange = vi.fn()
    render(<Segmented options={options} value="grid" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(onChange).toHaveBeenCalledWith('list')
  })

  it('renders accent active option', () => {
    render(<Segmented options={options} value="grid" onChange={vi.fn()} accent />)
    expect(screen.getByRole('button', { name: 'Grid' }).className).toContain('bg-accent')
  })

  it('names icon-only options', () => {
    render(
      <Segmented
        options={[
          { value: 'grid', label: 'Grid', icon: <span data-testid="grid-icon" /> },
          { value: 'list', label: 'List', icon: <span data-testid="list-icon" /> },
        ]}
        value="grid"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Grid' })).toContainElement(screen.getByTestId('grid-icon'))
    expect(screen.getByRole('button', { name: 'List' })).toContainElement(screen.getByTestId('list-icon'))
  })
})
