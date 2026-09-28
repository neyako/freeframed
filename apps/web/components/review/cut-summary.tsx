'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { cn, formatTime } from '@/lib/utils'
import { TARGET_PRESETS, afterCutSeconds, mergedCuts } from '@/lib/cuts'
import type { CommentWithReplies } from '@/hooks/use-comments'

interface CutSummaryProps {
  comments: CommentWithReplies[]
  /** Runtime of the version under review, seconds */
  duration: number
  target: number | null
  /** Omit to show the target read-only (guests) */
  onTargetChange?: (seconds: number | null) => void
}

/** "m:ss" or plain seconds → seconds; null when unparseable. */
function parseDuration(text: string): number | null {
  const parts = text.trim().split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 3) return null
  const seconds = parts.reduce((total, n) => total * 60 + n, 0)
  return seconds > 0 ? Math.round(seconds) : null
}

/** Counts toward a changed value over 160ms (one-shot; instant on first render
 * and when the user prefers reduced motion). */
function useTweened(value: number): number {
  const [shown, setShown] = React.useState(value)
  const shownRef = React.useRef(value)
  React.useEffect(() => {
    const from = shownRef.current
    if (from === value || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 160)
      const eased = 1 - (1 - p) ** 3
      shownRef.current = from + (value - from) * eased
      setShown(shownRef.current)
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return shown
}

/** After-cut runtime vs the target, above the comments that make the cuts. */
export function CutSummary({ comments, duration, target, onTargetChange }: CutSummaryProps) {
  const cuts = React.useMemo(() => mergedCuts(comments, duration), [comments, duration])
  const after = afterCutSeconds(duration, cuts)
  const shownAfter = useTweened(after)
  const [customOpen, setCustomOpen] = React.useState(false)
  const [customText, setCustomText] = React.useState('')

  const delta = target !== null ? target - after : null
  const preset = TARGET_PRESETS.find((p) => p.seconds === target)
  const targetLabel = target === null ? 'Target' : `${preset?.label ?? 'Target'} ${formatTime(target)}`

  function saveCustom() {
    const seconds = parseDuration(customText)
    if (seconds === null) return
    onTargetChange?.(seconds)
    setCustomOpen(false)
    setCustomText('')
  }

  const picker = (
    <>
        {customOpen ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              saveCustom()
            }}
          >
            <input
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCustomOpen(false)}
              placeholder="m:ss"
              aria-label="Target duration"
              className="h-6 w-20 rounded border border-border bg-bg-tertiary px-1.5 font-mono text-[12px] text-text-primary outline-none focus:border-text-tertiary"
            />
            <button type="submit" className="text-[12px] text-text-secondary hover:text-text-primary">
              Set
            </button>
          </form>
        ) : onTargetChange ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="inline-flex items-center gap-1 font-mono text-[11.5px] text-text-tertiary outline-none hover:text-text-primary">
              {targetLabel}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-[100] min-w-[180px] rounded-md border border-border bg-bg-elevated py-1 text-[12.5px] data-[state=open]:animate-ff-pop-in data-[state=closed]:animate-ff-pop-out"
              >
                {TARGET_PRESETS.map((p) => (
                  <DropdownMenu.Item
                    key={p.label}
                    onSelect={() => onTargetChange(p.seconds)}
                    className="flex cursor-pointer justify-between gap-4 px-3 py-1.5 text-text-secondary outline-none data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary"
                  >
                    {p.label}
                    <span className="font-mono text-text-tertiary">{formatTime(p.seconds)}</span>
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Item
                  onSelect={() => setCustomOpen(true)}
                  className="cursor-pointer px-3 py-1.5 text-text-secondary outline-none data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary"
                >
                  Custom…
                </DropdownMenu.Item>
                {target !== null && (
                  <DropdownMenu.Item
                    onSelect={() => onTargetChange(null)}
                    className="cursor-pointer border-t border-border px-3 py-1.5 text-text-tertiary outline-none data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary"
                  >
                    No target
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          target !== null && <span className="font-mono text-[11.5px] text-text-tertiary">{targetLabel}</span>
        )}
    </>
  )

  return (
    // One line with no target; the meter row only appears once there's a goal
    <div className="shrink-0 border-b border-border px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[18px] font-semibold tabular-nums text-text-primary">{formatTime(shownAfter)}</span>
        <span className="min-w-0 truncate text-[12.5px] text-text-tertiary">
          {cuts.length === 0
            ? 'no cuts yet'
            : target === null
              ? `after cuts, from ${formatTime(duration)}`
              : `from ${formatTime(duration)}`}
        </span>
        <div className="ml-auto flex shrink-0 items-baseline gap-3">
          {delta !== null && (
            <span className={cn('font-mono text-[12px] tabular-nums', delta >= 0 ? 'text-status-success' : 'text-accent')}>
              {delta >= 0 ? `${formatTime(delta)} left` : `${formatTime(-delta)} over`}
            </span>
          )}
          {picker}
        </div>
      </div>

      {target !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={cn('h-full', after > target ? 'bg-accent' : 'bg-text-primary')}
            style={{ width: `${Math.min(100, (after / target) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
