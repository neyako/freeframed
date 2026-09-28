'use client'

import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  LayoutGrid, List,
  ChevronDown, SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { menuContentClass } from '@/components/ui/surface'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import {
  useViewStore,
  type ViewLayout, type CardSize, type TitleLines,
} from '@/stores/view-store'

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <Switch
        size="sm"
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

// ─── Select dropdown row ────────────────────────────────────────────────────

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 cursor-pointer appearance-none rounded-md border border-border-strong bg-bg-secondary pl-2.5 pr-7 text-[12.5px] text-text-primary outline-none transition-colors duration-100 hover:bg-bg-hover"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-bg-elevated">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-text-tertiary pointer-events-none" />
      </div>
    </div>
  )
}

// ─── Main popover ───────────────────────────────────────────────────────────

export function AppearancePopover() {
  const {
    layout, setLayout,
    cardSize, setCardSize,
    showCardInfo, setShowCardInfo,
    titleLines, setTitleLines,
    flattenFolders, setFlattenFolders,
    showFileSize, setShowFileSize,
    showUploader, setShowUploader,
  } = useViewStore()

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'font-normal')}>
          <SlidersHorizontal />
          View
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className={cn(menuContentClass, 'w-72 space-y-2.5 p-3')}
        >
          {/* Layout */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">Layout</span>
            <Segmented<ViewLayout>
              options={[
                { value: 'grid', label: 'Grid', icon: <LayoutGrid className="h-[15px] w-[15px]" /> },
                { value: 'list', label: 'List', icon: <List className="h-[15px] w-[15px]" /> },
              ]}
              value={layout}
              onChange={setLayout}
              optionClassName="h-6 px-2"
            />
          </div>

          {/* Card Size — only in grid mode */}
          {layout === 'grid' && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-secondary">Size</span>
              <Segmented<CardSize>
                options={[
                  { value: 'S', label: 'S' },
                  { value: 'M', label: 'M' },
                  { value: 'L', label: 'L' },
                ]}
                value={cardSize}
                onChange={setCardSize}
                optionClassName="h-6 px-2"
              />
            </div>
          )}

          {/* Show Card Info */}
          <ToggleRow label="Show card info" checked={showCardInfo} onCheckedChange={setShowCardInfo} />

          {/* Titles */}
          {showCardInfo && (
            <SelectRow
              label="Titles"
              value={titleLines}
              options={[
                { value: '1', label: '1 line' },
                { value: '2', label: '2 lines' },
                { value: '3', label: '3 lines' },
              ]}
              onChange={(v) => setTitleLines(v as TitleLines)}
            />
          )}

          {/* Hides subfolders from the grid (does not pull in nested assets) */}
          <ToggleRow label="Hide folders" checked={flattenFolders} onCheckedChange={setFlattenFolders} />

          <div className="space-y-2.5 border-t border-border pt-2.5">
            <ToggleRow label="File size" checked={showFileSize} onCheckedChange={setShowFileSize} />
            <ToggleRow label="Uploader" checked={showUploader} onCheckedChange={setShowUploader} />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
