'use client'

import * as React from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { cn, formatRelativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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

function useSortedVersions(versions: AssetVersion[]): AssetVersion[] {
  return React.useMemo(
    () => [...versions].sort((a, b) => a.version_number - b.version_number),
    [versions],
  )
}

/** Menu rows, newest first. Not-ready versions can't be opened. */
function VersionMenuContent({
  sorted,
  align,
  sideOffset = 4,
}: {
  sorted: AssetVersion[]
  align: 'start' | 'end'
  sideOffset?: number
}) {
  const currentVersion = useReviewStore((s) => s.currentVersion)
  const setCurrentVersion = useReviewStore((s) => s.setCurrentVersion)
  const latestReady = sorted.findLast((v) => v.processing_status === 'ready')

  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        className="z-[100] max-h-[50vh] min-w-[200px] overflow-y-auto rounded-md border border-border bg-bg-elevated py-1 text-[12.5px] data-[state=open]:animate-ff-pop-in data-[state=closed]:animate-ff-pop-out"
      >
        {[...sorted].reverse().map((version) => {
          const active = currentVersion?.id === version.id
          const ready = version.processing_status === 'ready'
          const detail = ready
            ? `${version.id === latestReady?.id ? 'Latest · ' : ''}${formatRelativeTime(version.created_at)}`
            : STATUS_TITLE[version.processing_status]
          return (
            <DropdownMenu.Item
              key={version.id}
              disabled={!ready}
              onSelect={() => setCurrentVersion(version)}
              className={cn(
                'flex cursor-pointer justify-between gap-4 px-3 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary',
                active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary',
              )}
            >
              <span className={cn('font-mono', version.processing_status === 'failed' && 'line-through')}>
                v{version.version_number}
              </span>
              <span className="text-text-tertiary">{detail}</span>
            </DropdownMenu.Item>
          )
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

/**
 * Version picker. Wide screens get inline tabs, every version one click away;
 * phones get a dropdown so a long version list can't overflow the header.
 */
export function VersionSwitcher({ versions, className }: VersionSwitcherProps) {
  const currentVersion = useReviewStore((s) => s.currentVersion)
  const setCurrentVersion = useReviewStore((s) => s.setCurrentVersion)
  const sorted = useSortedVersions(versions)

  if (sorted.length < 2) return null

  return (
    <div className={cn('flex items-center', className)}>
      <div
        role="tablist"
        aria-label="Version"
        className="hidden max-w-[40vw] items-center overflow-x-auto rounded-md border border-border-strong p-0.5 font-mono text-[12px] sm:flex"
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

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Version"
            className="gap-1 font-mono text-text-primary data-[state=open]:bg-bg-hover sm:hidden [&_svg]:h-3 [&_svg]:w-3"
          >
            v{currentVersion?.version_number ?? sorted[sorted.length - 1].version_number}
            <ChevronDown className="text-text-tertiary" />
          </Button>
        </DropdownMenu.Trigger>
        <VersionMenuContent sorted={sorted} align="end" />
      </DropdownMenu.Root>
    </div>
  )
}

interface VersionNameMenuProps {
  name: string
  versions: AssetVersion[]
  className?: string
}

const NAME_CLASS = 'truncate text-[13px] font-medium leading-tight text-text-primary'

/**
 * The asset name as the version picker: tapping it lists the versions. The
 * version stays out of sight on the latest one; an older one gets a badge so
 * it can't pass for the latest.
 */
export function VersionNameMenu({ name, versions, className }: VersionNameMenuProps) {
  const currentVersion = useReviewStore((s) => s.currentVersion)
  const sorted = useSortedVersions(versions)

  if (sorted.length < 2) return <div className={cn(NAME_CLASS, className)}>{name}</div>

  const latestReady = sorted.findLast((v) => v.processing_status === 'ready')
  const olderVersion =
    currentVersion && latestReady && currentVersion.id !== latestReady.id ? currentVersion : null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn('flex max-w-full items-center gap-1.5 text-left outline-none', className)}
      >
        <span className={NAME_CLASS}>{name}</span>
        {olderVersion && (
          <span className="inline-flex h-4 shrink-0 items-center justify-center rounded bg-text-primary px-1 font-mono text-[11px] leading-none text-bg-primary">
            v{olderVersion.version_number}
          </span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-text-tertiary" />
      </DropdownMenu.Trigger>
      {/* Drops past the folder line under the name to the header's bottom edge */}
      <VersionMenuContent sorted={sorted} align="start" sideOffset={23} />
    </DropdownMenu.Root>
  )
}
