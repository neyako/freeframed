'use client'

import { Loader2, Video } from 'lucide-react'
import { useVideoPlayer } from '@/hooks/use-video-player'
import { cn } from '@/lib/utils'
import { resolveStreamUrl } from './share-stream'

export { resolveStreamUrl }

interface ShareVideoPlayerProps {
  src: string
  className?: string
}

export function ShareVideoPlayer({ src, className }: ShareVideoPlayerProps) {
  const { videoRef, isLoading, error } = useVideoPlayer(resolveStreamUrl(src))

  return (
    <div className={cn('relative w-full h-full flex items-center justify-center bg-black', className)}>
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        className="max-h-full max-w-full"
      />
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
          <Video className="h-10 w-10 text-zinc-700" />
          <p className="text-sm text-zinc-500">Video unavailable</p>
        </div>
      )}
    </div>
  )
}
