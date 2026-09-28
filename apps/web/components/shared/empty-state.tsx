import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  /** One short line, e.g. "No assets yet." */
  title: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({ title, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex items-center gap-3 py-2 text-[13px] text-text-secondary', className)}>
      <p>{title}</p>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
