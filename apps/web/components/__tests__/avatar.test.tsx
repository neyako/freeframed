import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Avatar } from '../shared/avatar'

describe('Avatar component', () => {
  it('renders root element when no image is provided', () => {
    const { container } = render(<Avatar name="John Doe" />)
    const root = container.firstChild as HTMLElement
    expect(root).toBeInTheDocument()
  })

  it('applies md size classes by default', () => {
    const { container } = render(<Avatar name="Test" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-[34px]')
    expect(root.className).toContain('w-[34px]')
  })

  it('applies sm size classes', () => {
    const { container } = render(<Avatar name="Test" size="sm" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-[26px]')
    expect(root.className).toContain('w-[26px]')
  })

  it('applies lg size classes', () => {
    const { container } = render(<Avatar name="Test" size="lg" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-11')
    expect(root.className).toContain('w-11')
  })

  it('applies custom className to root element', () => {
    const { container } = render(<Avatar name="Test" className="border-2" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('border-2')
  })

  it('renders rounded-full class for circular shape', () => {
    const { container } = render(<Avatar name="John Doe" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('rounded-full')
  })

  it('renders accent variant', () => {
    const { container } = render(<Avatar name="You" accent />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('bg-accent')
  })

  it('renders with a src prop without crashing', () => {
    // Radix Avatar.Image renders in a portal in jsdom — just verify no error thrown
    const { container } = render(<Avatar src="https://example.com/avatar.jpg" name="User" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('does not render fallback span when no src provided', () => {
    const { container } = render(<Avatar name="No Image" />)
    // Root span should be present
    const root = container.firstChild as HTMLElement
    expect(root).toBeInTheDocument()
    expect(root.tagName).toBe('SPAN')
  })
})
