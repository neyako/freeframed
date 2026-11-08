import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Format seconds into "M:SS" or "H:MM:SS"
 * e.g. 83 → "1:23", 3725 → "1:02:05"
 */
export function formatTime(seconds: number): string {
  const totalSeconds = Math.floor(seconds)
  const hrs = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Format seconds into SMPTE timecode "HH:MM:SS:FF" at 24fps
 * e.g. 83.5 → "00:01:23:12"
 */
export function formatTimecode(seconds: number, fps = 24): string {
  const totalFrames = Math.floor(seconds * fps)
  const frames = totalFrames % fps
  const totalSeconds = Math.floor(totalFrames / fps)
  const secs = totalSeconds % 60
  const mins = Math.floor(totalSeconds / 60) % 60
  const hrs = Math.floor(totalSeconds / 3600)

  return [
    String(hrs).padStart(2, '0'),
    String(mins).padStart(2, '0'),
    String(secs).padStart(2, '0'),
    String(frames).padStart(2, '0'),
  ].join(':')
}

/**
 * Format seconds as frame count at given fps
 * e.g. 83.5 at 24fps → "2004"
 */
export function formatFrames(seconds: number, fps = 24): string {
  return String(Math.floor(seconds * fps))
}

/**
 * Format bytes into human-readable size string
 * e.g. 1_610_612_736 → "1.5 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${parseFloat(value.toFixed(1))} ${units[i]}`
}

/**
 * Format an ISO date string into a relative time string
 * e.g. "2 hours ago", "3 days ago", "just now"
 */
export function formatRelativeTime(date: string): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diffMs = now - then
  const diffSecs = Math.floor(diffMs / 1000)

  if (diffSecs < 60) return 'just now'

  const diffMins = Math.floor(diffSecs / 60)
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`

  const diffYears = Math.floor(diffMonths / 12)
  return `${diffYears} year${diffYears !== 1 ? 's' : ''} ago`
}

/**
 * Truncate a string to the given length, appending "..." if truncated
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

/**
 * The expiry instant for a day picked in an `<input type="date">`: the last
 * millisecond of that day in the user's local time zone, as an ISO string.
 *
 * Do not build it with `new Date('YYYY-MM-DDT23:59:59Z')`: that is the end of
 * the day in UTC, so a link expired hours before (west of UTC) or after (east of
 * it) the end of the day the user picked.
 */
export function endOfDayISO(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

/**
 * The value for an `<input type="date">` showing a stored `expires_at`: the
 * calendar day that instant falls on in the user's local time zone. The inverse
 * of `endOfDayISO`; slicing the ISO string would show the UTC day, which is the
 * wrong one for anyone west of UTC.
 */
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Copy text to the clipboard. Returns true only when the text was written.
 *
 * Uses the async Clipboard API when the page has it. Plain-HTTP origins (a LAN
 * IP, a home server without TLS) are not secure contexts and have no
 * `navigator.clipboard`, so the fallback runs `document.execCommand('copy')`
 * and writes the text from inside the `copy` event it fires. Copying the
 * selection of an off-screen textarea is not enough on its own: inside a Radix
 * dialog the focus trap pulls focus back as soon as the textarea is selected,
 * the selection is lost, and the copy succeeds with an empty string.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Refused (permissions policy, document not focused): try execCommand.
    }
  }
  return copyWithExecCommand(text)
}

function copyWithExecCommand(text: string): boolean {
  let written = false
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
    written = true
  }

  const previousFocus = document.activeElement as HTMLElement | null
  // Safari enables the copy command only when something is selected.
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.contentEditable = 'true'
  textarea.readOnly = false
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '-9999px'

  document.addEventListener('copy', onCopy, true)
  try {
    document.body.appendChild(textarea)
    if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
      // iOS Safari requires the selection to be on an editable element
      const range = document.createRange()
      range.selectNodeContents(textarea)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      textarea.setSelectionRange(0, text.length)
    } else {
      textarea.select()
      textarea.setSelectionRange(0, text.length)
    }
    // A true return only says the command ran; the listener says our text was
    // what it put on the clipboard.
    return document.execCommand('copy') && written
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy, true)
    textarea.remove()
    if (previousFocus && previousFocus !== document.activeElement && document.contains(previousFocus)) {
      previousFocus.focus?.()
    }
  }
}
