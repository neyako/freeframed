import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LoginForm } from '../login-form'

const mocks = vi.hoisted(() => ({
  fetchUser: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
  }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      fetchUser: mocks.fetchUser,
    }),
  },
}))

const originalLocation = window.location

describe('LoginForm 401 handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('shows the login error without refreshing or leaving the page', async () => {
    // Given
    const user = userEvent.setup()
    const initialHref = 'http://localhost/login'
    const locationMock = { href: initialHref, pathname: '/login' }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      configurable: true,
      writable: true,
    })
    const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.endsWith('/auth/logout')) {
        return new Response(null, { status: 204 })
      }
      return new Response(JSON.stringify({ detail: 'Invalid email or password' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)

    // When
    await user.type(screen.getByLabelText('Email address'), 'reviewer@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    // Then
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(window.location.href).toBe(initialHref)
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.fetchUser).not.toHaveBeenCalled()
  })
})
