'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronRight, Folder as FolderIcon, X, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { dialogContentClass, dialogOverlayClass } from '@/components/ui/surface'
import type { FolderTreeNode } from '@/types'

interface MoveToDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  tree: FolderTreeNode[]
  /** The folder currently being browsed (null = project root) */
  currentFolderId: string | null
  /** IDs of items being moved — disable moving into themselves */
  movingFolderIds?: string[]
  onMove: (targetFolderId: string | null) => void
}

/** Flatten tree to find a node by id */
function findNode(nodes: FolderTreeNode[], id: string): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

/** Build breadcrumb path from root to a given node id */
function buildPath(nodes: FolderTreeNode[], targetId: string): FolderTreeNode[] {
  for (const node of nodes) {
    if (node.id === targetId) return [node]
    const sub = buildPath(node.children, targetId)
    if (sub.length) return [node, ...sub]
  }
  return []
}

/** Check if candidateId is an ancestor-or-self of targetId */
function isAncestorOrSelf(nodes: FolderTreeNode[], candidateId: string, targetId: string): boolean {
  if (candidateId === targetId) return true
  const node = findNode(nodes, candidateId)
  if (!node) return false
  const path = buildPath(nodes, targetId)
  return path.some((n) => n.id === candidateId)
}

export function MoveToDialog({
  open,
  onOpenChange,
  projectName,
  tree,
  currentFolderId,
  movingFolderIds = [],
  onMove,
}: MoveToDialogProps) {
  // The folder we're browsing inside the dialog
  const [browseFolderId, setBrowseFolderId] = React.useState<string | null>(null)

  // Reset to root when dialog opens
  React.useEffect(() => {
    if (open) setBrowseFolderId(null)
  }, [open])

  // Children at current browse level
  const children = browseFolderId
    ? (findNode(tree, browseFolderId)?.children ?? [])
    : tree

  // Breadcrumb path
  const breadcrumbs = browseFolderId ? buildPath(tree, browseFolderId) : []

  // Can we move to this destination?
  // Disable: same as where items already are, or inside a folder being moved
  const isDisabled = (folderId: string | null): boolean => {
    if (folderId === currentFolderId) return true
    if (folderId !== null && movingFolderIds.some((mid) =>
      isAncestorOrSelf(tree, mid, folderId),
    )) return true
    return false
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={cn(dialogContentClass, 'max-w-sm p-0')}>
          <Dialog.Description className="sr-only">Choose a destination folder.</Dialog.Description>
          <div className="flex h-11 items-center gap-1.5 border-b border-border px-2">
            {browseFolderId && (
              <button
                type="button"
                aria-label="Up one level"
                onClick={() => setBrowseFolderId(breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
              >
                <ArrowLeft className="h-[15px] w-[15px]" />
              </button>
            )}

            <Dialog.Title className="flex min-w-0 flex-1 items-center gap-1 truncate px-1 text-[13px] font-medium text-text-primary">
              <button type="button" className="truncate hover:text-text-secondary" onClick={() => setBrowseFolderId(null)}>
                {projectName}
              </button>
              {breadcrumbs.map((crumb) => (
                <React.Fragment key={crumb.id}>
                  <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary" />
                  <button type="button" className="truncate hover:text-text-secondary" onClick={() => setBrowseFolderId(crumb.id)}>
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </Dialog.Title>

            <Dialog.Close
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
            >
              <X className="h-[15px] w-[15px]" />
            </Dialog.Close>
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {children.length === 0 ? (
              <p className="px-2 py-2 text-[13px] text-text-tertiary">No subfolders.</p>
            ) : (
              children.map((folder) => {
                const disabled = movingFolderIds.includes(folder.id)
                return (
                  <button
                    key={folder.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setBrowseFolderId(folder.id)}
                    className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-text-primary transition-colors duration-100 hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FolderIcon className="h-[15px] w-[15px] shrink-0 text-text-tertiary" />
                    <span className="flex-1 truncate">{folder.name}</span>
                    {folder.children.length > 0 && (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    )}
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2.5">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isDisabled(browseFolderId)}
              onClick={() => {
                onMove(browseFolderId)
                onOpenChange(false)
              }}
            >
              Move here
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
