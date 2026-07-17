'use client'

import useSWR, { mutate as globalMutate } from 'swr'
import { api } from '@/lib/api'
import type { Comment, Annotation, CommentReaction } from '@/types'

// ─── Extended comment type with nested data ───────────────────────────────────

/** Attachment as returned by the API (`AttachmentResponse`) */
export interface CommentAttachmentInfo {
  id: string
  file_name: string
  file_size: number
  content_type: string
  /** presigned S3 GET URL, generated at response time */
  url: string
}

export interface CommentWithReplies extends Comment {
  replies: CommentWithReplies[]
  annotation: Annotation | null
  reactions: CommentReaction[]
  attachments?: CommentAttachmentInfo[]
  author: {
    id: string
    name: string
    avatar_url: string | null
  } | null
  guest_author: {
    id: string
    name: string
  } | null
}

interface CreateCommentPayload {
  body: string
  version_id?: string
  timecode_start?: number
  timecode_end?: number
  annotation?: {
    drawing_data: Record<string, unknown>
    frame_number?: number
    carousel_position?: number
  }
  parent_id?: string
  visibility?: string
}

/** Presign + upload comment attachments (sequential — these are small files). */
export async function uploadCommentAttachments(commentId: string, files: File[]): Promise<void> {
  for (const file of files) {
    const presign = await api.post<{ upload_url: string; attachment_id: string }>(
      `/comments/${commentId}/attachments`,
      { file_name: file.name, content_type: file.type, file_size: file.size },
    )
    const res = await fetch(presign.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!res.ok) throw new Error(`Failed to upload ${file.name}`)
  }
}

function buildSWRKey(assetId: string | null, versionId: string | null): string | null {
  if (!assetId || !versionId) return null
  return `/assets/${assetId}/comments?version_id=${versionId}`
}

export function useComments(assetId: string | null, versionId: string | null) {
  const swrKey = buildSWRKey(assetId, versionId)

  const { data, error, isLoading, mutate } = useSWR<CommentWithReplies[]>(
    swrKey,
    (key: string) => api.get<CommentWithReplies[]>(key),
    {
      revalidateOnFocus: false,
    },
  )

  const comments = data ?? []

  // ─── Create comment ─────────────────────────────────────────────────────────

  async function createComment(
    body: string,
    timecodeStart?: number,
    timecodeEnd?: number,
    annotationData?: Record<string, unknown>,
    parentId?: string,
    visibility?: string,
    mentionUserIds?: string[],
  ): Promise<CommentWithReplies> {
    if (!assetId) throw new Error('No asset selected')
    if (!versionId) throw new Error('No version selected')

    const payload: CreateCommentPayload = { body, version_id: versionId }
    if (timecodeStart !== undefined) payload.timecode_start = timecodeStart
    if (timecodeEnd !== undefined) payload.timecode_end = timecodeEnd
    if (annotationData) payload.annotation = { drawing_data: annotationData }
    if (parentId) payload.parent_id = parentId
    if (visibility) payload.visibility = visibility
    if (mentionUserIds?.length) (payload as any).mention_user_ids = mentionUserIds

    const endpoint = parentId
      ? `/assets/${assetId}/comments/${parentId}/replies`
      : `/assets/${assetId}/comments`

    const newComment = await api.post<CommentWithReplies>(endpoint, payload)
    await mutate()
    return newComment
  }

  // ─── Resolve comment ─────────────────────────────────────────────────────────

  async function resolveComment(commentId: string): Promise<void> {
    await api.post(`/comments/${commentId}/resolve`)
    await mutate()
  }

  // ─── Delete comment ──────────────────────────────────────────────────────────

  async function deleteComment(commentId: string): Promise<void> {
    await api.delete(`/comments/${commentId}`)
    await mutate()
  }

  // ─── Reactions ───────────────────────────────────────────────────────────────

  async function addReaction(commentId: string, emoji: string): Promise<void> {
    await api.post(`/comments/${commentId}/react`, { emoji })
    await mutate()
  }

  async function removeReaction(commentId: string, emoji: string): Promise<void> {
    await api.post(`/comments/${commentId}/react`, { emoji })
    await mutate()
  }

  return {
    comments,
    isLoading,
    error,
    mutate,
    createComment,
    resolveComment,
    deleteComment,
    addReaction,
    removeReaction,
  }
}
