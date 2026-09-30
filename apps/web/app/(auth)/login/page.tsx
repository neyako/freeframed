'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { postLoginPath } from '@/lib/auth'
import { LoginForm } from '@/components/auth/login-form'
import type { SetupStatus, User } from '@/types'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    // Send first-time installs to setup, and already signed-in users onward
    async function redirectIfNeeded() {
      try {
        const status = await api.get<SetupStatus>('/setup/status')
        if (status.needs_setup) {
          router.replace('/setup')
          return
        }
        await api.get<User>('/auth/me')
        window.location.replace(postLoginPath())
      } catch {
        // not signed in — show the form
      }
    }
    redirectIfNeeded()
  }, [router])

  return <LoginForm />
}
