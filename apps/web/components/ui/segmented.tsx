'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly icon?: React.ReactNode
}

export interface SegmentedProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly accent?: boolean
  readonly stretch?: boolean
  readonly className?: string
  readonly optionClassName?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accent = false,
  stretch = false,
  className,
  optionClassName,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        'inline-flex gap-[3px] rounded bg-bg-tertiary border border-border p-[3px]',
        stretch && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            data-active={active ? 'true' : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center rounded-none px-[15px] py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-text-secondary transition-colors hover:text-text-primary',
              stretch && 'flex-1',
              active && 'border border-border-strong bg-bg-primary text-text-primary',
              active && accent && 'bg-accent text-white border-accent',
              optionClassName,
            )}
          >
            {option.icon ?? option.label}
          </button>
        )
      })}
    </div>
  )
}
