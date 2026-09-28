'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  dialogCloseClass,
  dialogContentClass,
  dialogOverlayClass,
  dialogTitleClass,
} from '@/components/ui/surface'

interface NameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
  submitLabel?: string
  onSubmit: (name: string) => void
}

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder = 'Name',
  defaultValue = '',
  submitLabel = 'Create',
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = React.useState(defaultValue)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) setValue(defaultValue)
  }, [open, defaultValue])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          className={cn(dialogContentClass, 'max-w-sm')}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
            inputRef.current?.select()
          }}
        >
          <Dialog.Close className={dialogCloseClass} aria-label="Close">
            <X />
          </Dialog.Close>

          <Dialog.Title className={dialogTitleClass}>
            {title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-1 text-[13px] text-text-secondary">
              {description}
            </Dialog.Description>
          )}

          <form onSubmit={handleSubmit} className="mt-3 space-y-3">
            <Input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!value.trim()}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
