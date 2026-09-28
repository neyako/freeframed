import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProjectCard } from '../project-card'
import type { Project } from '@/types'

vi.mock('@/components/shared/toast', () => ({
  useToast: () => ({ error: vi.fn() }),
}))

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Poster Project',
    description: 'Client review queue',
    created_by: 'user-1',
    poster_url: null,
    created_at: '2026-07-01T08:00:00Z',
    deleted_at: null,
    asset_count: 8,
    storage_bytes: 1024,
    role: 'owner',
    ...overrides,
  }
}

describe('ProjectCard', () => {
  it('shows the item count and size when a project has no poster', () => {
    render(<ProjectCard project={makeProject()} />)

    expect(screen.getByText(/^8 items · /)).toBeInTheDocument()
  })

  it('renders the poster image when provided', () => {
    render(<ProjectCard project={makeProject({ poster_url: '/poster.jpg' })} />)

    expect(screen.getByAltText('Poster Project')).toHaveAttribute('src', '/poster.jpg')
  })
})
