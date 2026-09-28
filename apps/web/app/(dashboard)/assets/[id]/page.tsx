'use client'

import * as React from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'

import { api } from '@/lib/api'
import type { AssetResponse } from '@/types'

export default function AssetRedirectPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const assetId = typeof params.id === 'string' ? params.id : ''
  const { data: asset, error } = useSWR<AssetResponse>(
    assetId ? `/assets/${assetId}` : null,
    (key: string) => api.get<AssetResponse>(key),
  )

  React.useEffect(() => {
    if (!asset) return
    // Keep deep-link params (?commentId=, ?versionId=) from emailed/copied links
    const query = searchParams.toString()
    router.replace(`/projects/${asset.project_id}/assets/${asset.id}${query ? `?${query}` : ''}`)
  }, [asset, router, searchParams])

  if (error) {
    return (
      <p className="px-4 py-6 text-[13px] text-status-error">Could not open asset.</p>
    )
  }

  return (
    <p className="px-4 py-6 text-[13px] text-text-tertiary">Opening asset…</p>
  )
}
