import type { AssetResponse } from '@/types'

export function normalizeAssetName(raw: string): string {
  const noExt = raw.replace(/\.[^/.]+$/, '')
  return noExt
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    // Trailing version markers: "_2", "_v2", "(v2)", and glued word+digit
    // forms like "_draft2" / "_final3". Keyword must be glued to the digits —
    // "hero cut 2" strips only the " 2" so it still matches "Hero Cut".
    .replace(
      /(?:[\s_-]+(?:v\.?\s*|(?:draft|version|ver|rev|final)\.?)?\d+|\s*\(\s*(?:v\.?\s*)?\d+\s*\))$/i,
      '',
    )
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
