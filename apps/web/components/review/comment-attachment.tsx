'use client'

import * as React from 'react'
import { FileText, Film, ImageIcon, Download, Trash2, Loader2 } from 'lucide-react'
import { cn, formatBytes } from '@/lib/utils'
import type { CommentAttachmentInfo } from '@/hooks/use-comments'

// ─── Props ────────────────────────────────────────────────────────────────────

interface CommentAttachmentProps {
  attachment: CommentAttachmentInfo
  isOwn?: boolean
  onDelete?: (attachmentId: string) => Promise<void>
  className?: string
}

// ─── File type icon helper ─────────────────────────────────────────────────────

function FileIcon({ contentType, className }: { contentType: string; className?: string }) {
  if (contentType.startsWith('image/')) return <ImageIcon className={cn('h-5 w-5', className)} />
  if (contentType.startsWith('video/')) return <Film className={cn('h-5 w-5', className)} />
  return <FileText className={cn('h-5 w-5', className)} />
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommentAttachment({
  attachment,
  isOwn,
  onDelete,
  className,
}: CommentAttachmentProps) {
  const [deleting, setDeleting] = React.useState(false)
  const [imageError, setImageError] = React.useState(false)

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true)
    try {
      await onDelete(attachment.id)
    } finally {
      setDeleting(false)
    }
  }

  const isImage = attachment.content_type.startsWith('image/') && !imageError
  const isVideo = attachment.content_type.startsWith('video/')

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border border-border bg-bg-secondary',
        className,
      )}
    >
      {/* Image preview */}
      {isImage && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.url}
            alt={attachment.file_name}
            className="max-h-48 w-full object-cover"
            onError={() => setImageError(true)}
          />
          {/* Overlay on hover */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              download={attachment.file_name}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </a>
            {isOwn && onDelete && (
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-status-error/80 text-white hover:bg-status-error transition-colors disabled:opacity-50"
                onClick={handleDelete}
                disabled={deleting}
                title="Delete attachment"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Video preview */}
      {isVideo && !isImage && (
        <div className="relative bg-black">
          <video
            src={attachment.url}
            className="max-h-48 w-full object-contain"
            controls={false}
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/60 p-3">
              <Film className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
      )}

      {/* File info row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="shrink-0 text-text-tertiary">
          <FileIcon contentType={attachment.content_type} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="truncate text-xs font-medium text-text-primary">
            {attachment.file_name}
          </p>
          <p className="text-2xs text-text-tertiary">
            {formatBytes(attachment.file_size)}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.file_name}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
          {isOwn && onDelete && (
            <button
              className="inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-bg-hover hover:text-status-error transition-colors disabled:opacity-50"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete attachment"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
