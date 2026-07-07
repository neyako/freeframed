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
 * Storage usage bar: app usage against real disk capacity.
 * `usedBytes` override lets the project sidebar show per-project usage
 * against the same disk total.
 */
export function StorageMeter({ usedBytes, className }: { usedBytes?: number; className?: string }) {
  const { data } = useStorageStats()

  const used = usedBytes ?? data?.used_bytes ?? 0
  const total = data?.disk_total_bytes ?? null
  const free = data?.disk_free_bytes ?? null
  const pct = total ? Math.min((used / total) * 100, 100) : 0

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">Storage</span>
        <span
          className={cn(
            'font-mono text-[10px] tracking-[0.02em] tabular-nums',
            pct >= 90 ? 'text-accent' : 'text-text-secondary',
          )}
        >
          {formatBytes(used)}
          {total !== null && ` / ${formatBytes(total)}`}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-bg-hover overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      {free !== null && (
        <span className="font-mono text-[10px] tracking-[0.02em] text-text-tertiary tabular-nums">
          {formatBytes(free)} free
        </span>
      )}
    </div>
  )
}
