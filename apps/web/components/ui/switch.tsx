'use client'

import * as React from 'react'
import * as RadixSwitch from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

type SwitchSize = 'sm' | 'md'

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof RadixSwitch.Root> {
  size?: SwitchSize
}

const rootClasses: Record<SwitchSize, string> = {
  sm: 'h-[22px] w-10',
  md: 'h-7 w-[52px]',
}

const thumbClasses: Record<SwitchSize, string> = {
  sm: 'h-4 w-4 data-[state=checked]:translate-x-[20px]',
  md: 'h-[22px] w-[22px] data-[state=checked]:translate-x-[26px]',
}

const Switch = React.forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  SwitchProps
>(({ className, size = 'md', ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-bg-tertiary transition-colors duration-200 data-[state=checked]:border-accent data-[state=checked]:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
      rootClasses[size],
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb
      className={cn(
        'block translate-x-[2px] rounded-full bg-text-secondary transition-transform duration-200 ease-spring data-[state=checked]:bg-accent',
        thumbClasses[size],
      )}
    />
  </RadixSwitch.Root>
))
Switch.displayName = 'Switch'

export { Switch }
