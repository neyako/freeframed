import * as React from 'react'
import { cn } from '@/lib/utils'
import type { AssetStatus } from '@/types'

interface BadgeProps {
  status: AssetStatus
  className?: string
}

const statusConfig: Record<AssetStatus, { label: string; className: string; dotClassName?: string }> = {
  draft: {
    label: 'Draft',
    className: 'text-text-tertiary border-border bg-transparent',
  },
  in_review: {
    label: 'In Review',
    className: 'text-text-primary border-border-strong bg-transparent',
    dotClassName: 'animate-blink',
  },
  approved: {
    label: 'Approved',
    className: 'bg-text-primary text-text-inverse border-text-primary',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-accent text-white border-accent',
  },
  archived: {
    label: 'Archived',
    className: 'text-text-tertiary border-border-secondary border-dashed bg-transparent',
  },
}

export function Badge({ status, className }: BadgeProps) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-none border px-2 py-0.5 font-mono text-[10px] font-normal uppercase tracking-[0.14em] leading-[14px]',
        config.className,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current shrink-0', config.dotClassName)} />
      {config.label}
    </span>
  )
}
