import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/types'

import SettingsPage from '../page'

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: mocks.user, fetchUser: vi.fn() }
    return selector ? selector(state) : state
  },
}))

function person(overrides: Partial<User>): User {
  return {
    id: 'u1',
    email: 'owner@example.com',
    name: 'Owner',
    avatar_url: null,
    status: 'active',
    is_superadmin: false,
    email_verified: true,
    preferences: {},
    created_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

const owner = person({ is_superadmin: true })
const editor = person({ id: 'u2', name: 'Minh', email: 'minh@example.com' })

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <SettingsPage />
    </SWRConfig>,
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
  })

  it('hides owner-only sections for non-owners', () => {
    mocks.user = editor
    renderPage()

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Workspace name' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'People' })).not.toBeInTheDocument()
    expect(mocks.get).not.toHaveBeenCalledWith('/users/people')
  })

  it('deactivates a person only after confirming', async () => {
    mocks.user = owner
    mocks.get.mockResolvedValue([owner, editor])
    mocks.post.mockResolvedValue({ ...editor, status: 'deactivated' })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    expect(mocks.post).not.toHaveBeenCalled()
    expect(screen.getByText('Deactivate Minh?')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/users/u2/deactivate'))
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
  })
})
