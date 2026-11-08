import { describe, it, expect } from 'vitest'
import { getInitials } from '../avatar'

describe('getInitials', () => {
  it('uses words only, so punctuation never becomes an initial', () => {
    expect(getInitials('Mai (Acme)')).toBe('MA')
    expect(getInitials('Nguyễn Văn An')).toBe('NA')
    expect(getInitials('neyako')).toBe('N')
    expect(getInitials('  ')).toBe('?')
  })
})
