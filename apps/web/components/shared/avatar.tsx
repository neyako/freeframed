'use client'

import * as React from 'react'
import * as RadixAvatar from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

type AvatarSize = 'sm' | 'md' | 'lg'

interface AvatarProps {
  src?: string | null
  name?: string | null
  size?: AvatarSize
  accent?: boolean
  className?: string
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'h-[26px] w-[26px] text-[9px]',
  md: 'h-[34px] w-[34px] text-[11px]',
  lg: 'h-11 w-11 text-[13px]',
}

function getInitials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

export function Avatar({ src, name, size = 'md', accent = false, className }: AvatarProps) {
  return (
    <RadixAvatar.Root
      className={cn(
        'relative inline-flex items-center justify-center rounded-full overflow-hidden bg-bg-tertiary border border-border-strong shrink-0',
        accent && 'bg-accent border-accent',
        sizeClasses[size],
        className,
      )}
    >
      {src && (
        <RadixAvatar.Image
          src={src}
          alt={name ?? 'Avatar'}
          className="h-full w-full object-cover"
        />
      )}
      <RadixAvatar.Fallback
        className={cn(
          'flex h-full w-full items-center justify-center font-mono font-normal tracking-[0.04em] text-text-primary',
          accent && 'text-white',
        )}
        delayMs={0}
      >
        {getInitials(name)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
