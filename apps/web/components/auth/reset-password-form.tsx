'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { setTokens } from '@/lib/auth'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AuthTokens } from '@/types'

interface ResetPasswordFormProps {
  token: string
}

interface FormErrors {
  password?: string
  confirmPassword?: string
  general?: string
}

function validate(password: string, confirmPassword: string): FormErrors {
  const errors: FormErrors = {}
  if (!password) {
    errors.password = 'Password is required'
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters'
  }
  if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match'
  return errors
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validation = validate(password, confirmPassword)
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      return
    }

    setSubmitting(true)
    setErrors({})
    try {
      const res = await api.post<AuthTokens>('/auth/reset-password', {
        token,
        password,
      })
      setTokens(res.access_token, res.refresh_token)
      await useAuthStore.getState().fetchUser()
      router.replace('/projects')
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ general: err.detail })
      } else {
        setErrors({ general: 'Something went wrong. Please try again.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-semibold text-text-primary">Choose a new password</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {errors.general && (
          <>
            <p role="alert" className="text-[12.5px] text-accent">{errors.general}</p>
            <Link href="/forgot-password" className="text-[12.5px] text-text-secondary transition-colors duration-100 hover:text-text-primary">
              Request a new link
            </Link>
          </>
        )}

        <Input
          label="Password"
          type="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })) }}
          error={errors.password}
        />

        <Input
          label="Confirm password"
          type="password"
          placeholder="Repeat password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); setErrors((p) => ({ ...p, confirmPassword: undefined })) }}
          error={errors.confirmPassword}
        />

        <Button type="submit" loading={submitting} className="mt-1 w-full">
          {submitting ? 'Saving…' : 'Reset password'}
        </Button>
      </form>
    </div>
  )
}
