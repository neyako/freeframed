'use client'

import { Button } from '@/components/ui/button'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: ErrorProps) {
  return (
    <div className="space-y-3 px-4 py-6 text-[13px]">
      <div>
        <h2 className="font-medium text-text-primary">Something went wrong.</h2>
        {process.env.NODE_ENV === 'development' && error?.message && (
          <p className="mt-1 font-mono text-[12px] text-text-tertiary">{error.message}</p>
        )}
        {error?.digest && (
          <p className="mt-1 text-text-tertiary">
            Error ID <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
