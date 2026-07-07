'use client'

import { ResetPasswordForm } from '@/components/auth/reset-password-form'

interface ResetPasswordPageProps {
  params: { token: string }
}

export default function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { token } = params
  return <ResetPasswordForm token={token} />
}
