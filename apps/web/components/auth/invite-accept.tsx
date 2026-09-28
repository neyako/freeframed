'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { setTokens } from '@/lib/auth'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AuthTokens } from '@/types'

interface InviteDetails {
  readonly email: string
  readonly org_name: string
  readonly inviter_name: string | null
}

interface InviteAcceptProps {
  token: string
}

interface FormErrors {
  name?: string
  password?: string
  confirmPassword?: string
  general?: string
}

function validate(name: string, password: string, confirmPassword: string): FormErrors {
  const errors: FormErrors = {}
  if (!name.trim()) errors.name = 'Name is required'
  if (!password) {
    errors.password = 'Password is required'
  } else if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters'
  }
  if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match'
  return errors
}

export function InviteAccept({ token }: InviteAcceptProps) {
  const router = useRouter()
  const [invite, setInvite] = useState<InviteDetails | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(true)

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function fetchInvite() {
      try {
        const data = await api.get<InviteDetails>(`/auth/invite/${token}`)
        setInvite(data)
      } catch (err) {
        if (err instanceof ApiError) {
          setInviteError(err.status === 404 ? 'This invite link is invalid or has expired.' : err.detail)
        } else {
          setInviteError('Failed to load invite details.')
        }
      } finally {
        setInviteLoading(false)
      }
    }
    fetchInvite()
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validation = validate(name, password, confirmPassword)
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      return
    }

    setSubmitting(true)
    setErrors({})
    try {
      const res = await api.post<AuthTokens>('/auth/accept-invite', {
        token,
        name,
        password,
      })
      setTokens(res.access_token, res.refresh_token)
      await useAuthStore.getState().fetchUser()
      router.replace('/')
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

  if (inviteLoading) {
    return (
      <p className="text-[13px] text-text-tertiary">Loading…</p>
    )
  }

  if (inviteError) {
    return (
      <div className="space-y-1 text-[13px]">
        <h2 className="text-[18px] font-semibold text-text-primary">Invalid invite</h2>
        <p className="text-text-secondary">{inviteError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold text-text-primary">
          Join{invite ? <> <span>{invite.org_name}</span></> : null}
        </h2>
        {invite && (
          <p className="text-[12.5px] text-text-secondary">
            {invite.inviter_name && <>Invited by {invite.inviter_name} · </>}
            <span>{invite.email}</span>
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {errors.general && (
          <p role="alert" className="text-[12.5px] text-accent">{errors.general}</p>
        )}

        <Input
          label="Name"
          type="text"
          placeholder="Alex Johnson"
          autoComplete="name"
          value={name}
          onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })) }}
          error={errors.name}
        />

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
          {submitting ? 'Joining…' : 'Create account and join'}
        </Button>
      </form>
    </div>
  )
}
