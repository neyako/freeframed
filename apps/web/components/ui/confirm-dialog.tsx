'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from './button'
import { dialogContentClass, dialogOverlayClass, dialogTitleClass } from './surface'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  loading?: boolean
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = React.useState(false)

  async function handleConfirm() {
    setIsLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // let caller handle errors
    } finally {
      setIsLoading(false)
    }
  }

  const busy = loading || isLoading

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          className={cn(dialogContentClass, 'max-w-sm')}
        >
          <Dialog.Title className={dialogTitleClass}>
            {title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-text-secondary">
              {description}
            </Dialog.Description>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={variant === 'danger' ? 'destructive' : 'primary'}
              size="sm"
              onClick={handleConfirm}
              loading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
