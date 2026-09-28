'use client'

import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useViewStore, type SortKey } from '@/stores/view-store'
import { buttonVariants } from '@/components/ui/button'
import { menuContentClass, menuItemClass } from '@/components/ui/surface'

const sortOptions: { value: SortKey; label: string }[] = [
  { value: 'custom', label: 'Manual' },
  { value: 'date', label: 'Date' },
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
]

export function SortPopover() {
  const { sortKey, setSortKey, sortDirection, toggleSortDirection } = useViewStore()
  const activeLabel = sortOptions.find((o) => o.value === sortKey)?.label ?? 'Manual'

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'font-normal')}>
          {activeLabel}
          <ChevronDown className="!h-3 !w-3" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className={cn(menuContentClass, 'w-48')}
        >
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                if (sortKey === opt.value) {
                  toggleSortDirection()
                } else {
                  setSortKey(opt.value)
                }
              }}
              className={cn(menuItemClass, sortKey === opt.value && 'text-text-primary')}
            >
              <span className="w-4 shrink-0">
                {sortKey === opt.value && <Check />}
              </span>
              {opt.label}
              {sortKey === opt.value && (
                <span className="ml-auto font-mono text-[11px] text-text-tertiary">
                  {sortDirection === 'asc' ? 'A-Z' : 'Z-A'}
                </span>
              )}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
