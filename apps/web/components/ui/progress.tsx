import * as React from 'react'
import { cn } from '@/lib/utils'

interface SegmentedProgressProps {
  readonly value: number
  readonly cells?: number
  readonly label?: string
  readonly showValue?: boolean
  readonly className?: string
}

interface ProgressTrackProps {
  readonly value: number
  readonly accent?: boolean
  readonly className?: string
  /** amber fill — for the processing/transcode phase, matching the Processing badge */
  readonly warning?: boolean
  /** Animate a fixed-width segment instead of tracking `value` — for phases
   * with no real percent yet (e.g. transcode processing before progress is
   * reported), so the bar reads as "working" rather than stuck at 0. */
  readonly indeterminate?: boolean
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function SegmentedProgress({
  value,
  cells = 12,
  label,
  showValue = true,
  className,
}: SegmentedProgressProps) {
  const clamped = clampProgress(value)
  const filled = Math.round((clamped / 100) * cells)
  const accentStart = clamped >= 100 ? cells - Math.ceil(cells / 4) : cells

  return (
    <div className={cn('space-y-2', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between gap-3">
          {label && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary">
              {label}
            </span>
          )}
          {showValue && (
            <span
              className={cn(
                'font-dot font-bold text-[15px] text-text-primary',
                clamped >= 100 && 'text-accent',
              )}
            >
              {Math.round(clamped)}%
            </span>
          )}
        </div>
      )}
      <div className="flex gap-[3px]">
        {Array.from({ length: cells }, (_, index) => {
          const isFilled = index < filled
          const isAccent = isFilled && index >= accentStart
          return (
            <span
              key={index}
              data-filled={isFilled ? 'true' : undefined}
              data-accent={isAccent ? 'true' : undefined}
              className={cn(
                'h-3 flex-1 rounded-[1px] border border-border-secondary bg-bg-hover transition-colors',
                isFilled && 'bg-text-primary border-text-primary',
                isAccent && 'bg-accent border-accent',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

export function ProgressTrack({
  value,
  accent = false,
  warning = false,
  className,
  indeterminate = false,
}: ProgressTrackProps) {
  const clamped = clampProgress(value)
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-bg-hover overflow-hidden', className)}>
      <div
        className={cn(
          'h-full bg-text-primary',
          accent && 'bg-accent',
          warning && 'bg-amber-500',
          indeterminate && 'w-2/5 animate-indeterminate-slide',
        )}
        style={indeterminate ? undefined : { width: `${clamped}%` }}
      />
    </div>
  )
}
