import { api } from '@/lib/api'

const MAX_EDGE = 1280

/** Scale (w, h) down so the long edge is at most `max`. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/**
 * JPEG of the current video frame with the drawing on top, for agents reading
 * feedback. Drawings are stored relative to the visible video frame
 * (_canvasWidth/_canvasHeight from use-drawing), so they scale straight onto
 * the frame. Null when the frame can't be read (not loaded, or tainted).
 */
export async function captureAnnotationSnapshot(
  video: HTMLVideoElement,
  drawing: Record<string, unknown>,
): Promise<Blob | null> {
  if (!video.videoWidth || !video.videoHeight) return null
  const { width, height } = fitWithin(video.videoWidth, video.videoHeight)
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  // Grab the frame now, before anything async lets playback move on
  ctx.drawImage(video, 0, 0, width, height)

  const { StaticCanvas } = await import('fabric')
  // No retina scaling: the backing bitmap must match `out` 1:1 on high-DPI screens
  const layer = new StaticCanvas(document.createElement('canvas'), {
    width,
    height,
    renderOnAddRemove: false,
    enableRetinaScaling: false,
  })
  try {
    await layer.loadFromJSON(drawing)
    layer.backgroundColor = ''
    const scaleX = width / ((drawing._canvasWidth as number) || width)
    const scaleY = height / ((drawing._canvasHeight as number) || height)
    layer.getObjects().forEach((obj) => {
      obj.set({
        left: (obj.left ?? 0) * scaleX,
        top: (obj.top ?? 0) * scaleY,
        scaleX: (obj.scaleX ?? 1) * scaleX,
        scaleY: (obj.scaleY ?? 1) * scaleY,
      })
    })
    layer.renderAll()
    ctx.drawImage(layer.getElement(), 0, 0)
    return await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.85))
  } catch {
    return null // tainted frame or unreadable drawing; the comment still stands
  } finally {
    layer.dispose()
  }
}

/** The review page's main player (comment attachments can be videos too). */
export function reviewVideoElement(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video[data-review-video]')
}

export async function uploadAnnotationSnapshot(commentId: string, snapshot: Promise<Blob | null>): Promise<void> {
  const blob = await snapshot
  if (blob) await api.putBlob(`/comments/${commentId}/snapshot`, blob)
}
