import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssetVersion, AssetVersionStatus } from '@/types'
import { useReviewStore } from '@/stores/review-store'
import { ReviewProvider, useReview } from '../review-provider'
import { VersionSwitcher } from '../version-switcher'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  versionsRequestCount: 0,
}))
const originalSetInterval = window.setInterval.bind(window)

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

function version(
  processingStatus: AssetVersionStatus,
  versionNumber = 1,
): AssetVersion {
  return {
    id: `version-${versionNumber}`,
    asset_id: 'asset-1',
    version_number: versionNumber,
    processing_status: processingStatus,
    created_by: 'user-1',
    created_at: '2026-07-11T00:00:00Z',
    deleted_at: null,
    files: [],
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ReviewProbe() {
  const { error, versions } = useReview()
  const currentVersion = useReviewStore((state) => state.currentVersion)

  return (
    <div>
      <span data-testid="provider-status">{versions[0]?.processing_status}</span>
      <span data-testid="current-status">{currentVersion?.processing_status}</span>
      <span data-testid="provider-error">{error}</span>
    </div>
  )
}

describe('queued review status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.versionsRequestCount = 0
    useReviewStore.getState().reset()
    vi.stubGlobal('fetch', mocks.fetch)
    Element.prototype.hasPointerCapture ??= vi.fn(() => false)
    Element.prototype.setPointerCapture ??= vi.fn()
    Element.prototype.releasePointerCapture ??= vi.fn()
    Element.prototype.scrollIntoView ??= vi.fn()
  })

  afterEach(() => {
    Object.defineProperty(window, 'setInterval', {
      configurable: true,
      value: originalSetInterval,
    })
    vi.unstubAllGlobals()
  })

  it('parses and polls a queued share version until it becomes ready', async () => {
    let poll: (() => void) | null = null
    Object.defineProperty(window, 'setInterval', {
      configurable: true,
      value: (handler: TimerHandler, timeout?: number) => {
        if (typeof handler === 'function' && timeout === 5000) {
          poll = () => handler()
          return 1
        }
        return originalSetInterval(handler, timeout)
      },
    })
    mocks.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/versions/')) {
        mocks.versionsRequestCount += 1
        return jsonResponse({
          versions: [version(mocks.versionsRequestCount === 1 ? 'queued' : 'ready')],
        })
      }
      if (url.includes('/comments')) return jsonResponse([])
      return jsonResponse({ name: 'Queued asset', asset_type: 'video' })
    })

    render(
      <ReviewProvider assetId="asset-1" shareToken="share-token">
        <ReviewProbe />
      </ReviewProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('provider-status')).toHaveTextContent('queued')
    })
    expect(screen.getByTestId('current-status')).toHaveTextContent('queued')

    await act(async () => {
      poll?.()
    })

    expect(await screen.findByTestId('provider-status')).toHaveTextContent('ready')
    expect(screen.getByTestId('current-status')).toHaveTextContent('ready')
  })

  it('polls a queued share when the stream is not ready yet', async () => {
    let poll: (() => void) | null = null
    let streamRequestCount = 0
    Object.defineProperty(window, 'setInterval', {
      configurable: true,
      value: (handler: TimerHandler, timeout?: number) => {
        if (typeof handler === 'function' && timeout === 5000) {
          poll = () => handler()
          return 1
        }
        return originalSetInterval(handler, timeout)
      },
    })
    mocks.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/versions/')) {
        mocks.versionsRequestCount += 1
        return jsonResponse({
          versions: [version(mocks.versionsRequestCount === 1 ? 'queued' : 'ready')],
        })
      }
      if (url.includes('/comments')) return jsonResponse([])
      streamRequestCount += 1
      return streamRequestCount === 1
        ? new Response(JSON.stringify({ detail: 'No ready media file found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        : jsonResponse({ name: 'Queued asset', asset_type: 'video', version_id: 'version-1' })
    })

    render(
      <ReviewProvider assetId="asset-1" shareToken="share-token">
        <ReviewProbe />
      </ReviewProvider>,
    )

    await waitFor(() => {
      expect(mocks.fetch.mock.calls.map(([input]) => String(input))).toContainEqual(
        expect.stringContaining('/versions/'),
      )
    })
    expect(screen.getByTestId('current-status')).toHaveTextContent('queued')
    expect(screen.getByTestId('provider-error')).toBeEmptyDOMElement()
    await waitFor(() => expect(poll).not.toBeNull())

    await act(async () => {
      poll?.()
    })

    await waitFor(() => {
      expect(screen.getByTestId('provider-status')).toHaveTextContent('ready')
      expect(screen.getByTestId('current-status')).toHaveTextContent('ready')
    })
  })

  it('renders queued with a processing indicator and disables selection', async () => {
    const user = userEvent.setup()
    const readyVersion = version('ready', 1)
    const queuedVersion = version('queued', 2)
    useReviewStore.getState().setCurrentVersion(readyVersion)

    render(<VersionSwitcher versions={[readyVersion, queuedVersion]} />)
    await user.click(screen.getByRole('button', { name: /v1/i }))

    const queuedLabel = await screen.findByText('Queued')
    const queuedItem = queuedLabel.closest('[role="menuitem"]')
    expect(queuedItem).toHaveAttribute('data-disabled')
    expect(queuedItem?.querySelector('.animate-spin')).toBeInTheDocument()
    await user.click(queuedLabel)
    expect(useReviewStore.getState().currentVersion).toEqual(readyVersion)
  })
})
