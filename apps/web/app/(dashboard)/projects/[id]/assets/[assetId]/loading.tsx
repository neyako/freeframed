import * as React from 'react'

// Route-specific loading for the review screen. Without this, the (dashboard)
// group loading.tsx flashes a fake sidebar/header shell while the asset route
// loads — wrong chrome for a full-viewport video view. Rendered inside the
// dashboard template's flex column, so flex-1 fills the viewport area.
export default function AssetLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-bg-primary text-[13px] text-text-tertiary">
      Loading…
    </div>
  )
}
