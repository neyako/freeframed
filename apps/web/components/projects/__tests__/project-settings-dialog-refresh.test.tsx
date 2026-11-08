import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProjectSettingsDialog } from '../project-settings-dialog'
import type { Project } from '@/types'

vi.mock('@/lib/api', () => ({ api: { patch: vi.fn(), upload: vi.fn() } }))

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

const dialog = (project: Project, open = true) => (
  <ProjectSettingsDialog project={project} open={open} onOpenChange={() => {}} onUpdated={() => {}} />
)

describe('ProjectSettingsDialog', () => {
  it('keeps unsaved edits when the project list refetches the same project', () => {
    const { rerender } = render(dialog(makeProject()))
    fireEvent.change(screen.getByDisplayValue('Poster Project'), { target: { value: 'Renamed draft' } })

    // SWR revalidates on window focus: same project, new object
    rerender(dialog(makeProject({ asset_count: 9 })))

    expect(screen.getByDisplayValue('Renamed draft')).toBeInTheDocument()
  })

  it('starts from the saved project again each time it opens', () => {
    const { rerender } = render(dialog(makeProject()))
    fireEvent.change(screen.getByDisplayValue('Poster Project'), { target: { value: 'Discarded edit' } })

    rerender(dialog(makeProject(), false))
    rerender(dialog(makeProject(), true))

    expect(screen.getByDisplayValue('Poster Project')).toBeInTheDocument()
  })
})
