'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { SetupWizard } from '@/components/auth/setup-wizard'
import type { SetupStatus } from '@/types'

export default function SetupPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkSetup() {
      try {
        const status = await api.get<SetupStatus>('/setup/status')
        if (!status.needs_setup) {
          router.replace('/login')
          return
        }
      } catch {
        // If the endpoint fails, allow the page to render (might be first run)
      } finally {
        setChecking(false)
      }
    }
    checkSetup()
  }, [router])

  if (checking) {
    return <p className="text-[13px] text-text-tertiary">Loading…</p>
  }

  return <SetupWizard />
}
