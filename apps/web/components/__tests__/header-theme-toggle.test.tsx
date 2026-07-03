import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Header } from '../layout/header'

const mocks = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
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

vi.mock('@/stores/notification-store', () => ({
  useNotificationStore: () => ({
    unreadCount: 0,
    fetchNotifications: mocks.fetchNotifications,
  }),
}))

vi.mock('@/stores/branding-store', () => ({
  useBrandingStore: () => ({
    orgName: 'FreeFrame',
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
    mocks.fetchNotifications.mockClear()
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
