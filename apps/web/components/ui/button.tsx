'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'solid' | 'secondary' | 'ghost' | 'destructive'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-sans font-medium cursor-pointer transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // White on black: the one main action per view
        primary: 'bg-text-primary text-bg-primary hover:bg-text-primary/85',
        solid: 'bg-text-primary text-bg-primary hover:bg-text-primary/85',
        secondary: 'bg-bg-secondary text-text-primary border-border-strong hover:bg-bg-hover',
        ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
        destructive: 'bg-accent text-white hover:bg-accent-hover',
      },
      size: {
        sm: 'h-[30px] px-2.5 text-[12.5px]',
        md: 'h-[34px] px-3 text-[13px]',
        lg: 'h-10 px-4 text-[14px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading, children, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {/* Pending state is disabled + the caller's label, never a spinner */}
        {children}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
