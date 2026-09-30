import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AuthLayout from '../../../app/(auth)/layout'
import { LoginForm } from '../login-form'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  replace: vi.fn(),
  setTokens: vi.fn(),
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
  postLoginPath: () => '/',
  setTokens: mocks.setTokens,
}))

const originalLocation = window.location

describe('AuthLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'location', {
      value: { replace: mocks.replace },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('renders the freeframed wordmark around the form', () => {
    render(
      <AuthLayout>
        <form aria-label="Sign in" />
      </AuthLayout>,
    )

    expect(screen.getByRole('heading', { name: 'freeframed' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders the password sign-in form and submits credentials', async () => {
    const user = userEvent.setup()
    mocks.post.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
    })

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
    expect(mocks.replace).toHaveBeenCalledWith('/')
  })
})
