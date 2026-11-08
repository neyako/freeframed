'use client'

import useSWR from 'swr'
import { api } from '@/lib/api'
import { cn, formatBytes } from '@/lib/utils'

export interface StorageStats {
  used_bytes: number
  disk_total_bytes: number | null
  disk_free_bytes: number | null
}

export function useStorageStats() {
  return useSWR<StorageStats>('/workspace/storage', () => api.get<StorageStats>('/workspace/storage'), {
    revalidateOnFocus: false,
  })
}

/**
 * Storage bar: how full the disk is, with the app's share marked in white.
 * `usedBytes` override lets the project sidebar show per-project usage
 * against the same disk total.
 */
export function StorageMeter({ usedBytes, className }: { usedBytes?: number; className?: string }) {
  const { data } = useStorageStats()

  const used = usedBytes ?? data?.used_bytes ?? 0
  const total = data?.disk_total_bytes ?? null
  const free = data?.disk_free_bytes ?? null
  // The bar is the disk itself: everything on it counts toward running out,
  // not just freeframed's share, so the warning fires when the disk is full
  const diskPct = total && free !== null ? Math.min(((total - free) / total) * 100, 100) : 0
  const appPct = total ? Math.min((used / total) * 100, diskPct || 100) : 0
  const low = diskPct >= 90

  return (
    <div className={cn('flex flex-col gap-1 text-[12px]', className)}>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="text-text-secondary">Disk</span>
        {free !== null && (
          <span className={cn('font-mono tabular-nums', low ? 'text-accent' : 'text-text-tertiary')}>
            {formatBytes(free)} free
          </span>
        )}
      </div>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-bg-hover" title="Disk in use; the white part is your footage">
        <div className={cn('absolute inset-y-0 left-0', low ? 'bg-accent' : 'bg-text-tertiary')} style={{ width: `${diskPct}%` }} />
        <div className="absolute inset-y-0 left-0 bg-text-primary" style={{ width: `${Math.max(appPct, used > 0 ? 1 : 0)}%` }} />
      </div>
      <span className="whitespace-nowrap font-mono tabular-nums text-text-tertiary">{formatBytes(used)} of footage</span>
    </div>
  )
}
