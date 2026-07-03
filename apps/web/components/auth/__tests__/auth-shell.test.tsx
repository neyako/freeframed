import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import AuthLayout from '../../../app/(auth)/layout'
import { LoginForm } from '../login-form'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

describe('AuthLayout', () => {
  it('renders the freeframed wordmark with a red final letter', () => {
    render(
      <AuthLayout>
        <form aria-label="Sign in" />
      </AuthLayout>,
    )

    expect(screen.getByText('freeframe')).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'freeframed' })).getByText('d')).toHaveClass('text-accent')
  })

  it('surfaces the invalid email error before sending a code', async () => {
    const user = userEvent.setup()

    render(<LoginForm />)

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send magic code' }))

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
  })
})
