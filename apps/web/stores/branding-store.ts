import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'

type WorkspaceBrandingResponse = {
  readonly name: string
  readonly logo_dark: string | null
  readonly logo_light: string | null
}

interface BrandingState {
  orgName: string
  /** Logo for dark theme (shown on dark backgrounds) */
  orgLogoDark: string | null
  /** Logo for light theme (shown on light backgrounds) */
  orgLogoLight: string | null
  hydrateFromServer: () => Promise<void>
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
      orgName: 'freeframed',
      orgLogoDark: null,
      orgLogoLight: null,
      hydrateFromServer: async () => {
        try {
          const branding = await api.get<WorkspaceBrandingResponse>('/workspace')
          set(toBrandingState(branding))
        } catch {
          return
        }
      },
    }),
    {
      name: 'ff-branding',
      version: 2,
      migrate: () => ({
        orgName: 'freeframed',
        orgLogoDark: null,
        orgLogoLight: null,
      }),
    },
  ),
)
