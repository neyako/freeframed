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
  /** May return a promise; a rejection keeps the dialog open with its message */
  onSubmit: (name: string) => void | Promise<void>
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
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setError(null)
    }
  }, [open, defaultValue])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
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
            {error && <p className="text-[12px] text-accent">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!value.trim()} loading={busy}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
