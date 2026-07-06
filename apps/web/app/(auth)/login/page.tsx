'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { LoginForm } from '@/components/auth/login-form'
import type { SetupStatus } from '@/types'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to setup if first-time setup is needed
    async function checkSetup() {
      try {
        const status = await api.get<SetupStatus>('/setup/status')
        if (status.needs_setup) {
          router.replace('/setup')
        }
      } catch {
        // ignore — proceed to show login
      }
    }
    checkSetup()
  }, [router])

  return <LoginForm />
}
