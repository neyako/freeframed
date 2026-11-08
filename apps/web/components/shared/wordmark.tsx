import { cn } from '@/lib/utils'

/**
 * The freeframed mark: four viewfinder corners (the one place the logo uses
 * red) beside the name. Used in the app header, sign-in and guest pages.
 */
export function Wordmark({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold tracking-[-0.01em] text-text-primary', className)}>
      <svg viewBox="0 0 16 16" aria-hidden className="h-[1em] w-[1em] shrink-0 text-accent">
        <path
          d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        />
      </svg>
      {showName && 'freeframed'}
    </span>
  )
}
