'use client'

import * as React from 'react'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Folder, MoreHorizontal, Settings, Trash2 } from 'lucide-react'
import { cn, formatBytes } from '@/lib/utils'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  menuContentClass,
  menuItemClass,
  menuItemDangerClass,
  menuSeparatorClass,
} from '@/components/ui/surface'
import { useToast } from '@/components/shared/toast'
import { ProjectSettingsDialog } from './project-settings-dialog'
import type { Project } from '@/types'

interface ProjectCardProps {
  project: Project
  showRole?: boolean
  isOwner?: boolean
  className?: string
  onMutate?: () => void
}

export function ProjectCard({
  project,
  showRole,
  isOwner,
  className,
  onMutate,
}: ProjectCardProps) {
  const assetCount = project.asset_count ?? 0
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const toast = useToast()

  const handleDelete = async () => {
    try {
      await api.delete(`/projects/${project.id}`)
      onMutate?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete project')
      throw err
    }
  }

  const meta = [
    assetCount > 0
      ? `${assetCount} item${assetCount !== 1 ? 's' : ''} · ${formatBytes(project.storage_bytes ?? 0)}`
      : 'Empty',
    project.is_quick_share ? 'Quick shares' : null,
    showRole && project.role && project.role !== 'owner' ? 'Editor' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className={cn('group relative', className)}>
        <Link href={`/projects/${project.id}`} className="block">
          <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm border border-border bg-bg-tertiary text-text-tertiary transition-colors duration-100 group-hover:border-border-strong">
            {project.poster_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={project.poster_url}
                alt={project.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Folder className="h-[15px] w-[15px]" />
            )}
          </div>
          <p className="mt-1.5 truncate pr-7 text-[12.5px] text-text-primary">{project.name}</p>
          <p className="truncate font-mono text-[11.5px] text-text-tertiary">{meta}</p>
        </Link>

        {(isOwner || project.role === 'owner') && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={`${project.name} options`}
                className="absolute bottom-3 right-0 flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary opacity-0 transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
              >
                <MoreHorizontal className="h-[15px] w-[15px]" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menuContentClass} sideOffset={4} align="end">
                <DropdownMenu.Item className={menuItemClass} onSelect={() => setSettingsOpen(true)}>
                  <Settings />
                  Project settings
                </DropdownMenu.Item>
                <DropdownMenu.Separator className={menuSeparatorClass} />
                <DropdownMenu.Item className={menuItemDangerClass} onSelect={() => setDeleteOpen(true)}>
                  <Trash2 />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      <ProjectSettingsDialog
        project={project}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onUpdated={() => onMutate?.()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${project.name}"?`}
        description="The project and everything in it will be deleted."
        confirmLabel="Delete project"
        variant="danger"
        onConfirm={handleDelete}
      />
    </>
  )
}
