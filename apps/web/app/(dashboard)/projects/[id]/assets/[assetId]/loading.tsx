import * as React from 'react'

// Route-specific loading for the review screen. Without this, the (dashboard)
// group loading.tsx flashes a fake sidebar/header shell while the asset route
// loads — wrong chrome for a full-viewport video view. Rendered inside the
// dashboard template's flex column, so flex-1 fills the viewport area.
export default function AssetLoading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-bg-primary">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <span className="text-xs text-text-tertiary">Loading asset...</span>
    </div>
  )
}
