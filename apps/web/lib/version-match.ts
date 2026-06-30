import type { AssetResponse } from '@/types'

export function normalizeAssetName(raw: string): string {
  const noExt = raw.replace(/\.[^/.]+$/, '')
  return noExt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(?:[\s_-]+(?:v\.?\s*)?\d+|\s*\(\s*(?:v\.?\s*)?\d+\s*\))$/i, '')
    .trim()
}

export function findVersionCandidate(
  fileName: string,
  assets: readonly AssetResponse[],
): AssetResponse | null {
  const stem = normalizeAssetName(fileName)
  if (!stem) return null

  return assets.find((asset) => normalizeAssetName(asset.name) === stem) ?? null
}
