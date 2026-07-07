import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AuthLayout from '../../../app/(auth)/layout'
import { LoginForm } from '../login-form'

const mocks = vi.hoisted(() => ({
  fetchUser: vi.fn(),
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

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the freeframed wordmark with a red final letter', () => {
    render(
      <AuthLayout>
        <form aria-label="Sign in" />
      </AuthLayout>,
    )

    expect(screen.getByText('freeframe')).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'freeframed' })).getByText('d')).toHaveClass('text-accent')
  })

  it('renders the password sign-in form and submits credentials', async () => {
    const user = userEvent.setup()
    mocks.post.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
    })
    mocks.fetchUser.mockResolvedValue(undefined)

    render(<LoginForm />)

    const emailInput = screen.getByLabelText('Email address')
    const passwordInput = screen.getByLabelText('Password')
    const submitButton = screen.getByRole('button', { name: 'Sign in' })

    expect(emailInput).toBeInTheDocument()
    expect(passwordInput).toBeInTheDocument()

    await user.type(emailInput, 'reviewer@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/auth/login', {
        email: 'reviewer@example.com',
        password: 'password123',
      })
    })
    expect(mocks.setTokens).toHaveBeenCalledWith('access-token', 'refresh-token')
    expect(mocks.fetchUser).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith('/')
  })
})
