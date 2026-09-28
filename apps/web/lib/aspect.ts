import type { AssetResponse } from '@/types'

/** Width / height of the asset's media, for the justified grid. Unknown sizes
 * (audio, not yet processed) show as 16:9; extremes are clamped so a panorama
 * or a thin strip can't blow up a row. */
export function mediaAspect(asset: Pick<AssetResponse, 'latest_version'>): number {
  const file = asset.latest_version?.files?.find((f) => f.width && f.height)
  const ratio = file ? (file.width as number) / (file.height as number) : 16 / 9
  return Math.min(Math.max(ratio, 0.5), 2.4)
}
