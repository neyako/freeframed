import * as React from 'react'
import { cn } from '@/lib/utils'

interface ProgressTrackProps {
  readonly value: number
  readonly accent?: boolean
  readonly className?: string
  /** amber fill: the processing/transcode phase */
  readonly warning?: boolean
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function ProgressTrack({
  value,
  accent = false,
  warning = false,
  className,
}: ProgressTrackProps) {
  const fillColor = warning ? 'bg-amber-500' : accent ? 'bg-accent' : 'bg-text-primary'
  return (
    <div className={cn('h-1 w-full rounded-full bg-bg-hover overflow-hidden', className)}>
      <div className={cn('h-full', fillColor)} style={{ width: `${clampProgress(value)}%` }} />
    </div>
  )
}
