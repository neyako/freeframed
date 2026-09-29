import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useReviewStore } from '@/stores/review-store'
import type { AssetVersion } from '@/types'
import { VersionNameMenu } from '../version-switcher'

function version(n: number, status: AssetVersion['processing_status'] = 'ready'): AssetVersion {
  return {
    id: `v${n}`, asset_id: 'a1', version_number: n, processing_status: status,
    created_by: 'u1', created_at: '2026-09-29T00:00:00Z', deleted_at: null,
  } as AssetVersion
}

describe('VersionNameMenu', () => {
  beforeEach(() => useReviewStore.setState({ currentVersion: null }))

  it('badges an older version but not the latest ready one', () => {
    const versions = [version(1), version(2), version(3, 'processing')]
    useReviewStore.setState({ currentVersion: versions[1] })
    const { rerender } = render(<VersionNameMenu name="Clip" versions={versions} />)
    expect(screen.queryByText('v2')).not.toBeInTheDocument()

    useReviewStore.setState({ currentVersion: versions[0] })
    rerender(<VersionNameMenu name="Clip" versions={versions} />)
    expect(screen.getByText('v1')).toBeInTheDocument()
  })

  it('is a plain name with a single version', () => {
    render(<VersionNameMenu name="Clip" versions={[version(1)]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
