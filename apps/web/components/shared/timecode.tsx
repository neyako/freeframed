import { cn } from '@/lib/utils'

/**
 * A timecode readout: mono, tabular, with the leading zeros dimmed so the
 * digits that matter stand out ("00:00:03:06" reads as 3:06). Mono is
 * reserved for time; everything else in the UI is sans.
 */
export function Timecode({ value, className }: { value: string; className?: string }) {
  let lead = value.match(/^[0:]*/)?.[0] ?? ''
  // All zeros: keep the last pair lit so it still reads as a time
  if (lead.length >= value.length) lead = value.slice(0, Math.max(0, value.length - 2))
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {lead && <span className="opacity-40">{lead}</span>}
      {value.slice(lead.length)}
    </span>
  )
}

/** "a–b" with both ends dimmed the same way */
export function TimecodeRange({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <span className={cn('whitespace-nowrap', className)}>
      <Timecode value={start} />
      <span className="opacity-40">–</span>
      <Timecode value={end} />
    </span>
  )
}
