import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'ff-dotgrid flex flex-col items-center justify-center gap-3 py-12 px-6 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="flex h-[58px] w-[58px] items-center justify-center rounded border border-border-strong bg-bg-primary text-text-secondary">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-text-primary tracking-[-0.01em]">{title}</p>
        {description && (
          <p className="text-[13px] text-text-secondary max-w-[300px] leading-relaxed">{description}</p>
        )}
      </div>
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
