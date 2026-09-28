import * as React from 'react'
import { cn } from '@/lib/utils'

// Static placeholder blocks. No pulse/shimmer: loading chrome shouldn't repaint.

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn('rounded-sm bg-bg-tertiary', className)} {...props} />
}

interface SkeletonTextProps {
  className?: string
  /** Width as a Tailwind class, e.g. "w-1/2", "w-32". Defaults to "w-full" */
  width?: string
}

export function SkeletonText({ className, width = 'w-full' }: SkeletonTextProps) {
  return <Skeleton className={cn('h-3.5', width, className)} />
}

interface SkeletonGridProps {
  count?: number
  className?: string
}

export function SkeletonGrid({ count = 6, className }: SkeletonGridProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="aspect-video w-full" />
          <SkeletonText width="w-3/4" />
        </div>
      ))}
    </div>
  )
}
