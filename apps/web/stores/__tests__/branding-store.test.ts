import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrandingStore } from '../branding-store'

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

import { api } from '@/lib/api'

describe('Branding store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBrandingStore.setState({
      orgName: 'FreeFrame',
      orgLogoDark: null,
      orgLogoLight: null,
    })
  })

  it('hydrates workspace branding from server fields', async () => {
    vi.mocked(api.get).mockResolvedValue({
      name: 'Acme Studio',
      logo_dark: 'data:image/png;base64,dark',
      logo_light: 'data:image/png;base64,light',
    })

    await useBrandingStore.getState().hydrateFromServer()

    expect(api.get).toHaveBeenCalledWith('/workspace')
    expect(useBrandingStore.getState()).toMatchObject({
      orgName: 'Acme Studio',
      orgLogoDark: 'data:image/png;base64,dark',
      orgLogoLight: 'data:image/png;base64,light',
    })
  })

  it('keeps cached branding when hydration fails', async () => {
    useBrandingStore.setState({
      orgName: 'Cached Studio',
      orgLogoDark: 'data:image/png;base64,cached',
      orgLogoLight: null,
    })
    vi.mocked(api.get).mockRejectedValue(new Error('offline'))

    await expect(useBrandingStore.getState().hydrateFromServer()).resolves.toBeUndefined()

    expect(useBrandingStore.getState()).toMatchObject({
      orgName: 'Cached Studio',
      orgLogoDark: 'data:image/png;base64,cached',
      orgLogoLight: null,
    })
  })
})
