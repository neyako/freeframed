import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InviteAccept } from '../invite-accept'

const mocks = vi.hoisted(() => ({
  fetchUser: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  replace: vi.fn(),
  setTokens: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
  }),
}))

vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    readonly detail: string
    readonly status: number

    constructor(status: number, detail: string) {
      super(detail)
      this.status = status
      this.detail = detail
    }
  }

  return {
    api: {
      get: mocks.get,
      post: mocks.post,
    },
    ApiError: MockApiError,
  }
})

vi.mock('@/lib/auth', () => ({
  setTokens: mocks.setTokens,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      fetchUser: mocks.fetchUser,
    }),
  },
}))

describe('InviteAccept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders workspace name and hides inviter when inviter is null', async () => {
    mocks.get.mockResolvedValue({
      email: 'reviewer@example.com',
      org_name: 'Acme Studio',
      inviter_name: null,
    })

    render(<InviteAccept token="invite-token" />)

    expect(await screen.findByText('Acme Studio')).toBeInTheDocument()
    expect(screen.getByText('reviewer@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/as /)).not.toBeInTheDocument()
  })
})
