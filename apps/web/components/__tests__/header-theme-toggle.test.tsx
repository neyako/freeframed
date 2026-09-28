import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Header } from '../layout/header'

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  setTheme: vi.fn(),
  togglePanel: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
}))

vi.mock('@/stores/breadcrumb-store', () => ({
  useBreadcrumbStore: () => ({ labels: {}, extraCrumbs: [] }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { name: 'Neya Ko', avatar_url: null },
    logout: mocks.logout,
  }),
}))

vi.mock('@/stores/upload-store', () => ({
  useUploadStore: () => ({
    files: [],
    panelOpen: false,
    togglePanel: mocks.togglePanel,
  }),
}))

vi.mock('@/stores/branding-store', () => ({
  useBrandingStore: () => ({
    orgName: 'freeframed',
    orgLogoDark: null,
    orgLogoLight: null,
  }),
}))

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: () => ({
    theme: 'dark',
    setTheme: mocks.setTheme,
  }),
}))

describe('Header theme toggle', () => {
  beforeEach(() => {
    mocks.logout.mockClear()
    mocks.setTheme.mockClear()
    mocks.togglePanel.mockClear()
  })

  it("switches to light when the current theme is dark", () => {
    render(<Header onSearchOpen={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle color theme' }))

    expect(mocks.setTheme).toHaveBeenCalledWith('light')
  })
})
