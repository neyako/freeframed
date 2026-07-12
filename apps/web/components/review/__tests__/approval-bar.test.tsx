import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApprovalBar } from '../approval-bar'

const approved = {
  id: 'approval-1',
  asset_id: 'asset-1',
  version_id: 'version-1',
  user_id: 'user-1',
  status: 'approved' as const,
  note: null,
  created_at: '2026-07-12T00:00:00Z',
}

const mocks = vi.hoisted(() => ({
  data: [] as typeof approved[],
  mutate: vi.fn(),
  post: vi.fn(),
  error: null as Error | null,
}))

vi.mock('swr', () => ({
  default: () => ({ data: mocks.data, error: mocks.error, isLoading: false, mutate: mocks.mutate }),
}))
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: mocks.post } }))
vi.mock('@/components/shared/avatar', () => ({ Avatar: () => <span>Avatar</span> }))

describe('ApprovalBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.data = []
    mocks.error = null
    mocks.post.mockResolvedValue({})
    mocks.mutate.mockResolvedValue(undefined)
  })

  it('reads the API bare-list response and shows the current approval', () => {
    mocks.data = [approved]
    render(<ApprovalBar assetId="asset-1" versionId="version-1" currentUserId="user-1" />)

    expect(screen.getByText('You approved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('refreshes after approving and renders the refreshed list state', async () => {
    const { rerender } = render(
      <ApprovalBar assetId="asset-1" versionId="version-1" currentUserId="user-1" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/assets/asset-1/approve', {
      version_id: 'version-1',
    }))
    expect(mocks.mutate).toHaveBeenCalledOnce()

    mocks.data = [approved]
    rerender(<ApprovalBar assetId="asset-1" versionId="version-1" currentUserId="user-1" />)
    expect(screen.getByText('You approved')).toBeInTheDocument()
  })

  it('hides approval actions when the approval list fails to load', () => {
    mocks.error = new Error('Access denied')
    render(<ApprovalBar assetId="asset-1" versionId="version-1" currentUserId="user-1" />)

    expect(screen.getByText('Unable to load approvals')).toHaveClass('text-accent')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('keeps the reviewer list but hides actions for the version uploader', () => {
    mocks.data = [{ ...approved, id: 'approval-2', user_id: 'reviewer-2' }]

    render(
      <ApprovalBar
        assetId="asset-1"
        versionId="version-1"
        currentUserId="user-1"
        versionCreatedBy="user-1"
      />,
    )

    expect(screen.getByText('Avatar')).toBeInTheDocument()
    expect(screen.getByText('1 approved')).toBeInTheDocument()
    expect(screen.getByText('Your upload')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })
})
