import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'

type WorkspaceBrandingResponse = {
  readonly name: string
  readonly logo_dark: string | null
  readonly logo_light: string | null
}

type WorkspaceBrandingPatch = {
  readonly name?: string
  readonly logo_dark?: string | null
  readonly logo_light?: string | null
}

interface BrandingState {
  orgName: string
  /** Logo for dark theme (shown on dark backgrounds) */
  orgLogoDark: string | null
  /** Logo for light theme (shown on light backgrounds) */
  orgLogoLight: string | null
  setOrgName: (name: string) => void
  setOrgLogoDark: (url: string | null) => void
  setOrgLogoLight: (url: string | null) => void
  hydrateFromServer: () => Promise<void>
  saveToServer: (patch: WorkspaceBrandingPatch) => Promise<void>
  resetAll: () => void
}

function toBrandingState(branding: WorkspaceBrandingResponse) {
  return {
    orgName: branding.name,
    orgLogoDark: branding.logo_dark,
    orgLogoLight: branding.logo_light,
  }
}

export const useBrandingStore = create<BrandingState>()(
  persist(
    (set) => ({
      orgName: 'FreeFrame',
      orgLogoDark: null,
      orgLogoLight: null,
      setOrgName: (name) => set({ orgName: name }),
      setOrgLogoDark: (url) => set({ orgLogoDark: url }),
      setOrgLogoLight: (url) => set({ orgLogoLight: url }),
      hydrateFromServer: async () => {
        try {
          const branding = await api.get<WorkspaceBrandingResponse>('/workspace')
          set(toBrandingState(branding))
        } catch {
          return
        }
      },
      saveToServer: async (patch) => {
        const branding = await api.put<WorkspaceBrandingResponse>('/admin/workspace', patch)
        set(toBrandingState(branding))
      },
      resetAll: () => set({ orgName: 'FreeFrame', orgLogoDark: null, orgLogoLight: null }),
    }),
    {
      name: 'ff-branding',
      version: 2,
      migrate: () => ({
        orgName: 'FreeFrame',
        orgLogoDark: null,
        orgLogoLight: null,
      }),
    },
  ),
)
