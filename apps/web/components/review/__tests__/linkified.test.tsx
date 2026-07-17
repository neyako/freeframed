import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Linkified } from '../linkified'

describe('Linkified', () => {
  it('renders plain text unchanged', () => {
    render(<p><Linkified text="no links here" /></p>)
    expect(screen.getByText('no links here')).toBeTruthy()
  })

  it('turns URLs into links and keeps surrounding text', () => {
    render(<p data-testid="body"><Linkified text="see https://example.com/a?b=1 for ref" /></p>)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.href).toBe('https://example.com/a?b=1')
    expect(link.target).toBe('_blank')
    expect(screen.getByTestId('body').textContent).toBe('see https://example.com/a?b=1 for ref')
  })

  it('does not swallow trailing punctuation', () => {
    render(<p><Linkified text="check https://example.com/page." /></p>)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.href).toBe('https://example.com/page')
  })

  it('handles multiple URLs', () => {
    render(<p><Linkified text="https://a.com and http://b.com" /></p>)
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})
