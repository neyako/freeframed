'use client'

import React, { useState, useCallback } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  Trash2,
  MoreHorizontal,
  Pencil,
  FolderPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  menuContentClass,
  menuItemClass,
  menuItemDangerClass,
  menuSeparatorClass,
} from '@/components/ui/surface'
import type { FolderTreeNode } from '@/types'

interface FolderTreeProps {
  tree: FolderTreeNode[]
  currentFolderId: string | null // null = root
  showTrash: boolean
  onSelectFolder: (folderId: string | null) => void
  onShowTrash: () => void
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onDeleteFolder: (folderId: string) => Promise<void>
  // Drag-drop targets
  onDropItems?: (targetFolderId: string | null, assetIds: string[], folderIds: string[]) => void
}

interface FolderNodeProps {
  node: FolderTreeNode
  depth: number
  currentFolderId: string | null
  onSelectFolder: (folderId: string | null) => void
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onDeleteFolder: (folderId: string) => Promise<void>
  onDropItems?: (targetFolderId: string | null, assetIds: string[], folderIds: string[]) => void
}

const rowClass =
  'group flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors duration-100'
const rowActive = 'bg-bg-hover text-text-primary'
const rowIdle = 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'

function readDragPayload(e: React.DragEvent): { assetIds: string[]; folderIds: string[] } | null {
  try {
    const data = JSON.parse(e.dataTransfer.getData('application/json'))
    return { assetIds: data.assetIds ?? [], folderIds: data.folderIds ?? [] }
  } catch {
    return null
  }
}

function FolderNode({
  node,
  depth,
  currentFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDropItems,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState(node.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const isActive = currentFolderId === node.id
  const hasChildren = node.children.length > 0

  const handleClick = useCallback(() => {
    onSelectFolder(node.id)
    if (hasChildren) setExpanded((p) => !p)
  }, [node.id, hasChildren, onSelectFolder])

  const handleRename = useCallback(async () => {
    if (renameName.trim() && renameName !== node.name) {
      await onRenameFolder(node.id, renameName.trim())
    }
    setRenaming(false)
  }, [renameName, node.id, node.name, onRenameFolder])

  return (
    <div>
      <div
        className={cn(rowClass, isActive ? rowActive : rowIdle, isDragOver && rowActive)}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={handleClick}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          const data = readDragPayload(e)
          if (data) onDropItems?.(node.id, data.assetIds, data.folderIds)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuOpen(true)
        }}
      >
        {hasChildren ? (
          <ChevronRight className={cn('h-3 w-3 shrink-0', expanded && 'rotate-90')} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isActive || expanded ? (
          <FolderOpen className="h-[15px] w-[15px] shrink-0" />
        ) : (
          <FolderIcon className="h-[15px] w-[15px] shrink-0" />
        )}

        {renaming ? (
          <input
            className="min-w-0 flex-1 border-b border-text-primary/60 bg-transparent px-0.5 text-[12.5px] text-text-primary outline-none"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}

        {node.item_count > 0 && !renaming && (
          <span className="shrink-0 font-mono text-[11px] text-text-tertiary group-hover:hidden">
            {node.item_count}
          </span>
        )}

        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={`${node.name} options`}
              onClick={(e) => e.stopPropagation()}
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-primary group-hover:flex data-[state=open]:flex pointer-coarse:flex"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClass}>
              <DropdownMenu.Item
                className={menuItemClass}
                onSelect={() => {
                  setRenameName(node.name)
                  setRenaming(true)
                }}
              >
                <Pencil />
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menuItemClass} onSelect={() => onCreateFolder('', node.id)}>
                <FolderPlus />
                New subfolder
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={menuSeparatorClass} />
              <DropdownMenu.Item className={menuItemDangerClass} onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              currentFolderId={currentFolderId}
              onSelectFolder={onSelectFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onDropItems={onDropItems}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${node.name}"?`}
        description="The folder and its contents move to trash, where you can restore them."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => onDeleteFolder(node.id)}
      />
    </div>
  )
}

export function FolderTree({
  tree,
  currentFolderId,
  showTrash,
  onSelectFolder,
  onShowTrash,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDropItems,
}: FolderTreeProps) {
  const [isDragOverRoot, setIsDragOverRoot] = useState(false)
  const rootActive = currentFolderId === null && !showTrash

  return (
    <div className="space-y-0.5">
      <div
        className={cn(rowClass, rootActive || isDragOverRoot ? rowActive : rowIdle)}
        onClick={() => onSelectFolder(null)}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOverRoot(true)
        }}
        onDragLeave={() => setIsDragOverRoot(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOverRoot(false)
          const data = readDragPayload(e)
          if (data) onDropItems?.(null, data.assetIds, data.folderIds)
        }}
      >
        <FolderOpen className="h-[15px] w-[15px] shrink-0" />
        <span className="truncate">All files</span>
      </div>

      {tree.map((node) => (
        <FolderNode
          key={node.id}
          node={node}
          depth={0}
          currentFolderId={currentFolderId}
          onSelectFolder={onSelectFolder}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onDropItems={onDropItems}
        />
      ))}

      <div className={cn(rowClass, showTrash ? rowActive : rowIdle)} onClick={onShowTrash}>
        <Trash2 className="h-[15px] w-[15px] shrink-0" />
        <span>Trash</span>
      </div>
    </div>
  )
}
