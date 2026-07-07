'use client'

import * as React from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MAX_LOGO_DATA_URL_LENGTH = 2 * 1024 * 1024

interface LogoUploadSlotProps {
  readonly label: string
  readonly description: string
  readonly logoUrl: string | null
  readonly onUpload: (url: string) => void
  readonly onRemove: () => void
  readonly onError: (message: string) => void
  readonly previewBg: string
}

export function LogoUploadSlot({
  label,
  description,
  logoUrl,
  onUpload,
  onRemove,
  onError,
  previewBg,
}: LogoUploadSlotProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result
      if (typeof result !== 'string') return
      if (result.length > MAX_LOGO_DATA_URL_LENGTH) {
        onError('Logo file is too large. Use a smaller image under 2 MB.')
        return
      }
      onUpload(result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-border bg-bg-secondary">
      <div
        className={`h-16 w-16 rounded-xl border border-border flex items-center justify-center overflow-hidden shrink-0 ${previewBg}`}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={label} className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-xs text-text-tertiary text-center leading-tight px-1">No logo</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-tertiary mt-0.5 mb-3">{description}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            {logoUrl ? 'Replace' : 'Upload'}
          </Button>
          {logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-status-error hover:text-status-error hover:bg-status-error/10"
            >
              <X className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-2xs text-text-tertiary mt-2">PNG, JPG, SVG or WebP &middot; Max 2 MB</p>
      </div>
    </div>
  )
}
