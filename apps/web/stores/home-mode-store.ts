import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type HomeMode = 'review' | 'projects'

interface HomeModeStore {
  /** Landing page style: 'review' = upload-first dashboard, 'projects' = Frame.io-style project grid. */
  mode: HomeMode
  setMode: (mode: HomeMode) => void
}

export const useHomeModeStore = create<HomeModeStore>()(
  persist(
    (set) => ({
      mode: 'review',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'ff_home_mode' },
  ),
)
