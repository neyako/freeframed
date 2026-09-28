'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ImagePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dialogCloseClass,
  dialogContentClass,
  dialogOverlayClass,
  dialogTitleClass,
} from '@/components/ui/surface'
import type { Project } from '@/types'

interface ProjectSettingsDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}

export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
  onUpdated,
}: ProjectSettingsDialogProps) {
  const [name, setName] = React.useState(project.name)
  const [description, setDescription] = React.useState(project.description || '')
  const [posterPreview, setPosterPreview] = React.useState<string | null>(project.poster_url ?? null)
  const [posterFile, setPosterFile] = React.useState<File | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Sync state when project changes
  React.useEffect(() => {
    setName(project.name)
    setDescription(project.description || '')
    setPosterPreview(project.poster_url ?? null)
    setPosterFile(null)
  }, [project])

  const handlePosterSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPosterFile(file)
    setPosterPreview(URL.createObjectURL(file))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // Upload poster if changed
      if (posterFile) {
        const formData = new FormData()
        formData.append('file', posterFile)
        await api.upload(`/projects/${project.id}/poster`, formData)
      }

      // Update project fields
      await api.patch(`/projects/${project.id}`, {
        name: name.trim(),
        description: description.trim() || null,
      })

      onUpdated()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={cn(dialogContentClass, 'max-w-md')}>
          <Dialog.Close className={dialogCloseClass} aria-label="Close">
            <X />
          </Dialog.Close>
          <Dialog.Title className={dialogTitleClass}>Project settings</Dialog.Title>
          <Dialog.Description className="sr-only">
            Edit the project name, description and poster.
          </Dialog.Description>

          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change poster"
              className="group relative flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-bg-tertiary text-text-tertiary transition-colors duration-100 hover:border-border-strong hover:text-text-primary"
            >
              {posterPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={posterPreview} alt="Poster" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-[15px] w-[15px]" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handlePosterSelect}
            />
            <div className="min-w-0 flex-1">
              <Input
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor="project-settings-description" className="text-[12.5px] text-text-secondary">
              Description
            </label>
            <textarea
              id="project-settings-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="w-full resize-none rounded-md border border-border-strong bg-bg-secondary px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary transition-colors duration-100 focus:border-text-primary/60 focus:outline-none"
            />
          </div>

          {error && <p className="mt-2 text-[12px] text-status-error">{error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={!name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
