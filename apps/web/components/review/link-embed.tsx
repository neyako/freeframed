'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Play } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Hosts the API can preview (see routers/embeds.py); anything else stays a plain link.
const EMBEDDABLE_RE =
  /https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)\/[^\s<>"']+/i

export function firstEmbeddableUrl(text: string): string | null {
  return text.match(EMBEDDABLE_RE)?.[0].replace(/[.,;:!?)]+$/, '') ?? null
}

interface Embed {
  provider: string
  title: string | null
  author_name: string | null
  thumbnail_url: string | null
  embed_url: string | null
}

const PROVIDER_LABEL: Record<string, string> = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok' }

async function fetchEmbed(url: string): Promise<Embed | null> {
  // Public endpoint: guests on share pages see previews too
  const res = await fetch(`${API_URL}/embeds?url=${encodeURIComponent(url)}`)
  return res.ok ? res.json() : null
}

/** Preview card for a video link; click plays it in place. No iframe until clicked. */
export function LinkEmbed({ url }: { url: string }) {
  const { data: embed } = useSWR(['embed', url], () => fetchEmbed(url), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [playing, setPlaying] = React.useState(false)
  if (!embed) return null

  const vertical = embed.provider === 'tiktok' || /\/shorts\//.test(url)
  const frame = vertical ? 'aspect-[9/16] max-h-80 mx-auto' : 'aspect-video'

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border" onClick={(e) => e.stopPropagation()}>
      {playing && embed.embed_url ? (
        <iframe
          src={`${embed.embed_url}${embed.embed_url.includes('?') ? '&' : '?'}autoplay=1`}
          title={embed.title ?? 'Video'}
          className={`block w-full bg-black ${frame}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          className={`relative block w-full bg-black ${frame}`}
          onClick={() => (embed.embed_url ? setPlaying(true) : window.open(url, '_blank', 'noopener'))}
          aria-label={`Play ${embed.title ?? 'video'}`}
        >
          {embed.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={embed.thumbnail_url} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70">
              <Play className="h-4 w-4 fill-white text-white" />
            </span>
          </span>
        </button>
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-2.5 py-2 hover:bg-bg-tertiary"
      >
        {embed.title && <div className="line-clamp-2 text-[12.5px] leading-snug text-text-primary">{embed.title}</div>}
        <div className="text-[11.5px] text-text-tertiary">
          {[PROVIDER_LABEL[embed.provider] ?? embed.provider, embed.author_name].filter(Boolean).join(' · ')}
        </div>
      </a>
    </div>
  )
}
