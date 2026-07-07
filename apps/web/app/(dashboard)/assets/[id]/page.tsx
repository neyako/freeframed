'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Loader2 } from 'lucide-react'

import { api } from '@/lib/api'
import type { AssetResponse } from '@/types'

export default function AssetRedirectPage() {
  const router = useRouter()
  const params = useParams()
  const assetId = typeof params.id === 'string' ? params.id : ''
  const { data: asset, error } = useSWR<AssetResponse>(
    assetId ? `/assets/${assetId}` : null,
    (key: string) => api.get<AssetResponse>(key),
  )

  React.useEffect(() => {
    if (!asset) return
    router.replace(`/projects/${asset.project_id}/assets/${asset.id}`)
  }, [asset, router])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-status-error">
        Could not open asset.
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center gap-2 p-6 font-mono text-xs text-text-secondary">
      <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
      Opening asset...
    </div>
  )
}
