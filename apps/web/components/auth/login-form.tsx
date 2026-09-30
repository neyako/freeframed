'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api'
import { postLoginPath, setTokens } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AuthTokens } from '@/types'

export function LoginForm() {
  const [loading, setLoading] = useState(false)
  const [classicEmail, setClassicEmail] = useState('')
  const [classicPassword, setClassicPassword] = useState('')
  const [classicError, setClassicError] = useState('')

  async function handleClassicLogin(e: FormEvent) {
    e.preventDefault()
    setClassicError('')

    if (!classicEmail || !classicPassword) {
      setClassicError('Email and password are required')
      return
    }

    setLoading(true)
    try {
      const res = await api.post<AuthTokens>('/auth/login', {
        email: classicEmail,
        password: classicPassword,
      })
      setTokens(res.access_token, res.refresh_token)
      // Full navigation so middleware and the dashboard start from the fresh
      // session cookies instead of any client router state from before sign-in
      window.location.replace(postLoginPath())
    } catch (err) {
      if (err instanceof ApiError) {
        setClassicError(err.detail)
      } else {
        setClassicError('Invalid email or password')
      }
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-semibold text-text-primary">Sign in</h2>

      <form onSubmit={handleClassicLogin} className="flex flex-col gap-3">
        {classicError && (
          <p role="alert" className="text-[12.5px] text-accent">{classicError}</p>
        )}

        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={classicEmail}
          onChange={(e) => { setClassicEmail(e.target.value); setClassicError('') }}
        />

        <Input
          label="Password"
          type="password"
          placeholder="Your password"
          autoComplete="current-password"
          value={classicPassword}
          onChange={(e) => { setClassicPassword(e.target.value); setClassicError('') }}
        />

        <Button type="submit" loading={loading} className="mt-1 w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>

        <Link href="/forgot-password" className="text-[12.5px] text-text-secondary transition-colors duration-100 hover:text-text-primary">
          Forgot password?
        </Link>
      </form>
    </div>
  )
}
