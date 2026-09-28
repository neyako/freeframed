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
  readonly stretch?: boolean
  readonly className?: string
  readonly optionClassName?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  stretch = false,
  className,
  optionClassName,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        'inline-flex rounded-md border border-border-strong p-0.5',
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
              'inline-flex h-7 items-center justify-center rounded px-2.5 text-[12.5px] transition-colors duration-100',
              active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:text-text-primary',
              stretch && 'flex-1',
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
