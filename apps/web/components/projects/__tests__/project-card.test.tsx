import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProjectCard } from '../project-card'
import type { Project } from '@/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Poster Project',
    description: 'Client review queue',
    created_by: 'user-1',
    project_type: 'personal',
    poster_url: null,
    is_public: false,
    created_at: '2026-07-01T08:00:00Z',
    deleted_at: null,
    asset_count: 8,
    storage_bytes: 1024,
    role: 'owner',
    ...overrides,
  }
}

describe('ProjectCard', () => {
  it('renders a dot-grid count fallback when a project has no poster', () => {
    render(<ProjectCard project={makeProject()} />)

    expect(screen.getByText('08')).toBeInTheDocument()
  })

  it('renders the poster image when provided', () => {
    render(<ProjectCard project={makeProject({ poster_url: '/poster.jpg' })} />)

    expect(screen.getByAltText('Poster Project')).toHaveAttribute('src', '/poster.jpg')
  })

  it('shows the public pill for public projects', () => {
    render(<ProjectCard project={makeProject({ is_public: true })} />)

    expect(screen.getByText('Public')).toBeInTheDocument()
  })
})
