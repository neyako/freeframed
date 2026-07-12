import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CollectionsPage from '../page'

const mocks = vi.hoisted(() => ({
  swrKeys: [] as string[],
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'project-1' }) }))
vi.mock('next/link', () => ({ default: ({ children }: { readonly children: React.ReactNode }) => children }))
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key) mocks.swrKeys.push(key)
    if (key === '/projects/project-1') {
      return {
        data: {
          id: 'project-1',
          name: 'Scoped project',
          role: null,
          folder_access: {
            kind: 'folder_direct',
            accessible_root_ids: ['folder-a'],
            grants: [{ folder_id: 'folder-a', permission: 'comment' }],
          },
        },
        isLoading: false,
      }
    }
    return { data: undefined, isLoading: false, mutate: vi.fn() }
  },
}))
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

describe('CollectionsPage folder-direct access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.swrKeys.length = 0
  })

  it('denies folder-direct recipients before fetching collections or showing create controls', () => {
    render(<CollectionsPage />)

    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
    expect(screen.queryByText('New Collection')).not.toBeInTheDocument()
    expect(mocks.swrKeys).not.toContain('/projects/project-1/collections')
  })
})
