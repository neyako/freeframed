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

/** Source time → time in the edit. A moment inside a cut lands on the join. */
export function toEditTime(time: number, cuts: CutRange[]): number {
  let removed = 0
  for (const r of cuts) {
    if (r.start >= time) break
    removed += Math.min(time, r.end) - r.start
  }
  return time - removed
}

/** Time in the edit → source time. A join maps to just after its cut; before
 * the start maps to the first kept frame, so a cut at 0:00 is never landed in. */
export function toSourceTime(editTime: number, cuts: CutRange[]): number {
  let time = Math.max(0, editTime)
  for (const r of cuts) {
    if (r.start > time) break
    time += r.end - r.start
  }
  return time
}

/** The cut `time` is inside, if any. */
export function cutAt(time: number, cuts: CutRange[]): CutRange | undefined {
  // The 10ms slack stops a seek that lands a hair short of the end from re-seeking forever
  return cuts.find((c) => time >= c.start && time < c.end - 0.01)
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
