/** A range marked for removal from the edit, in seconds. */
export interface CutRange {
  start: number
  end: number
}

interface CutLike {
  is_cut?: boolean
  timecode_start: number | null
  timecode_end: number | null
}

/** Cut ranges from top-level comments, clamped to the runtime and merged where they overlap. */
export function mergedCuts(comments: CutLike[], duration: number): CutRange[] {
  const ranges = comments
    .filter((c) => c.is_cut && c.timecode_start !== null && c.timecode_end !== null)
    .map((c) => ({
      start: Math.max(0, Math.min(c.timecode_start as number, duration)),
      end: Math.max(0, Math.min(c.timecode_end as number, duration)),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)

  const merged: CutRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** Runtime left once every cut is taken out. Overlapping cuts count once. */
export function afterCutSeconds(duration: number, cuts: CutRange[]): number {
  const removed = cuts.reduce((sum, r) => sum + (r.end - r.start), 0)
  return Math.max(0, duration - removed)
}

/** Runtime targets offered in the picker (seconds). */
export const TARGET_PRESETS: { label: string; seconds: number }[] = [
  { label: 'Shorts', seconds: 180 },
  { label: 'Reels', seconds: 180 },
  { label: 'TikTok', seconds: 600 },
]

function clock(seconds: number, tenths: boolean): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const secs = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return `${m}:${secs}`
}

/** "0:06 → 0:08"; short ranges get tenths so 2.05–2.78s isn't "0:02 → 0:02". */
export function formatRange(start: number, end: number): string {
  const tenths = end - start < 10
  return `${clock(start, tenths)} → ${clock(end, tenths)}`
}

/** Length of a range: "0:13", or "0.7s" under ten seconds. */
export function formatSpan(seconds: number): string {
  return seconds < 10 ? `${seconds.toFixed(1)}s` : clock(seconds, false)
}
