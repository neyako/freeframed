'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!email) {
      setError('Email is required')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(err.detail)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-semibold text-text-primary">Reset password</h2>

      {sent ? (
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="text-text-secondary">
            If that email is registered, a reset link is on its way.
          </p>
          <Link href="/login" className="text-text-secondary transition-colors duration-100 hover:text-text-primary">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-[12.5px] text-accent">{error}</p>
          )}

          <Input
            label="Email address"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
          />

          <Button type="submit" loading={loading} className="mt-1 w-full">
            {loading ? 'Sending…' : 'Send reset link'}
          </Button>

          <Link href="/login" className="text-[12.5px] text-text-secondary transition-colors duration-100 hover:text-text-primary">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  )
}
