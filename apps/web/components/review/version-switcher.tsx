'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useReviewStore } from '@/stores/review-store'
import type { AssetVersion } from '@/types'

interface VersionSwitcherProps {
  versions: AssetVersion[]
  className?: string
}

const STATUS_TITLE: Record<AssetVersion['processing_status'], string> = {
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Processing failed',
}

/** Inline version tabs: every version one click away. Not-ready versions can't be opened. */
export function VersionSwitcher({ versions, className }: VersionSwitcherProps) {
  const currentVersion = useReviewStore((s) => s.currentVersion)
  const setCurrentVersion = useReviewStore((s) => s.setCurrentVersion)

  const sorted = React.useMemo(
    () => [...versions].sort((a, b) => a.version_number - b.version_number),
    [versions],
  )

  if (sorted.length < 2) return null

  return (
    <div
      role="tablist"
      aria-label="Version"
      className={cn(
        'flex max-w-[40vw] items-center overflow-x-auto rounded-md border border-border-strong p-0.5 font-mono text-[12px]',
        className,
      )}
    >
      {sorted.map((version) => {
        const active = currentVersion?.id === version.id
        const ready = version.processing_status === 'ready'
        return (
          <button
            key={version.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={!ready}
            title={`v${version.version_number} · ${STATUS_TITLE[version.processing_status]}`}
            onClick={() => setCurrentVersion(version)}
            className={cn(
              'h-6 shrink-0 rounded px-2',
              active ? 'bg-bg-hover text-text-primary' : 'text-text-tertiary hover:text-text-primary',
              !ready && 'cursor-not-allowed opacity-40',
              version.processing_status === 'failed' && 'line-through',
            )}
          >
            v{version.version_number}
          </button>
        )
      })}
    </div>
  )
}
