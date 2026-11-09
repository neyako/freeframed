import type { SortDirection, SortKey } from '@/stores/view-store'
import type { AssetResponse, AssetStatus } from '@/types'

const statusOrder: Record<AssetStatus, number> = {
  in_review: 0,
  draft: 1,
  approved: 2,
  rejected: 3,
  archived: 4,
}

/**
 * Assets in the order the project view shows them. The grid and the review
 * screen's previous/next both sort with this, so "next" is the card to the
 * right of the one you opened. `custom` keeps the order the API returned.
 */
export function sortAssets<T extends Pick<AssetResponse, 'updated_at' | 'name' | 'status' | 'asset_type'>>(
  assets: T[],
  sortKey: SortKey,
  sortDirection: SortDirection,
): T[] {
  const result = [...assets]
  if (sortKey === 'custom') return result

  result.sort((a, b) => {
    let cmp = 0
    if (sortKey === 'date') {
      cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
    } else if (sortKey === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else if (sortKey === 'status') {
      cmp = statusOrder[a.status] - statusOrder[b.status]
    } else if (sortKey === 'type') {
      cmp = a.asset_type.localeCompare(b.asset_type)
    }
    return sortDirection === 'asc' ? cmp : -cmp
  })
  return result
}
