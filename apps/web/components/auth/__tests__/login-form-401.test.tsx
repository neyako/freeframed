import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LoginForm } from '../login-form'

const originalLocation = window.location

function stubLocation(url: string) {
  const parsed = new URL(url)
  const locationMock = {
    href: url,
    origin: parsed.origin,
    pathname: parsed.pathname,
    search: parsed.search,
    replace: vi.fn(),
  }
  Object.defineProperty(window, 'location', {
    value: locationMock,
    configurable: true,
    writable: true,
  })
  return locationMock
}

async function submit(email: string, password: string) {
  const user = userEvent.setup()
  render(<LoginForm />)
  await user.type(screen.getByLabelText('Email address'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('LoginForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
  })

  it('shows the login error without refreshing or leaving the page', async () => {
    // Given
    const location = stubLocation('http://localhost/login')
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

    // When
    await submit('reviewer@example.com', 'wrong-password')

    // Then
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(location.replace).not.toHaveBeenCalled()
  })

  it.each([
    ['/projects/p1?tab=files', '/projects/p1?tab=files'],
    ['https://evil.example/phish', '/'],
    ['//evil.example', '/'],
  ])('lands on the safe `from` path after sign-in (%s)', async (from, expected) => {
    // Given
    const location = stubLocation(`http://localhost/login?from=${encodeURIComponent(from)}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'a', refresh_token: 'r', token_type: 'bearer' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))

    // When
    await submit('reviewer@example.com', 'right-password')

    // Then
    await waitFor(() => expect(location.replace).toHaveBeenCalledWith(expected))
  })
})
