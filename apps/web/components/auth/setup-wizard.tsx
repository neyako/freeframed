'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { setTokens } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FormState {
  email: string
  name: string
  password: string
  confirmPassword: string
  setupToken: string
}

interface FormErrors {
  email?: string
  name?: string
  password?: string
  confirmPassword?: string
  setupToken?: string
  general?: string
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.email) {
    errors.email = 'Email is required'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Enter a valid email address'
  }
  if (!form.name.trim()) {
    errors.name = 'Name is required'
  }
  if (!form.password) {
    errors.password = 'Password is required'
  } else if (form.password.length < 8) {
    errors.password = 'Password must be at least 8 characters'
  }
  if (!form.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password'
  } else if (form.password !== form.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match'
  }
  return errors
}

export function SetupWizard() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>({
    email: '',
    name: '',
    password: '',
    confirmPassword: '',
    setupToken: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
      // Clear field error on change
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }))
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validation = validate(form)
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      return
    }

    setLoading(true)
    setErrors({})
    try {
      const res = await api.post<{ access_token: string; refresh_token: string }>(
        '/setup/create-superadmin',
        {
          email: form.email,
          name: form.name,
          password: form.password,
          setup_token: form.setupToken || null,
        }
      )
      setTokens(res.access_token, res.refresh_token)
      setSuccess(true)
      setTimeout(() => {
        router.replace('/')
      }, 1800)
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ general: err.detail })
      } else {
        setErrors({ general: 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <p className="text-[13px] text-text-secondary">Admin account created. Opening your workspace…</p>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-semibold text-text-primary">Create the admin account</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {errors.general && (
          <p role="alert" className="text-[12.5px] text-accent">{errors.general}</p>
        )}

        <Input
          label="Name"
          type="text"
          placeholder="Alex Johnson"
          autoComplete="name"
          value={form.name}
          onChange={handleChange('name')}
          error={errors.name}
        />

        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={form.email}
          onChange={handleChange('email')}
          error={errors.email}
        />

        <Input
          label="Password"
          type="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          value={form.password}
          onChange={handleChange('password')}
          error={errors.password}
        />

        <Input
          label="Confirm password"
          type="password"
          placeholder="Repeat password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={handleChange('confirmPassword')}
          error={errors.confirmPassword}
        />

        <Input
          label="Setup token"
          type="password"
          placeholder="Bootstrap token"
          autoComplete="one-time-code"
          value={form.setupToken}
          onChange={handleChange('setupToken')}
          error={errors.setupToken}
        />

        <Button type="submit" loading={loading} className="mt-1 w-full">
          {loading ? 'Creating…' : 'Create admin account'}
        </Button>
      </form>
    </div>
  )
}
