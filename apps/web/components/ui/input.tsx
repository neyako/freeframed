'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, id, type, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    const [showPassword, setShowPassword] = React.useState(false)
    const isPassword = type === 'password'

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12.5px] text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-text-tertiary">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            type={isPassword && showPassword ? 'text' : type}
            className={cn(
              'flex h-[34px] w-full rounded-md border border-border-strong bg-bg-secondary px-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary',
              'transition-colors duration-100 focus:outline-none focus:border-text-primary/60',
              'disabled:cursor-not-allowed disabled:opacity-45',
              icon && 'pl-8',
              isPassword && 'pr-8',
              error && 'border-accent focus:border-accent',
              className,
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2.5 flex items-center text-text-tertiary hover:text-text-primary transition-colors duration-100"
            >
              {showPassword ? (
                <EyeOff className="h-[15px] w-[15px]" />
              ) : (
                <Eye className="h-[15px] w-[15px]" />
              )}
            </button>
          )}
        </div>
        {error && (
          <p className="text-[12px] text-accent">{error}</p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input }
