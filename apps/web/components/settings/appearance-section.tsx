'use client'

import { Segmented } from '@/components/ui/segmented'
import { useThemeStore, type Theme } from '@/stores/theme-store'
import { useHomeModeStore, type HomeMode } from '@/stores/home-mode-store'
import { useMounted } from '@/hooks/use-mounted'

const themes = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: Theme; label: string }[]

const homeModes = [
  { value: 'review', label: 'Review feed' },
  { value: 'projects', label: 'Projects' },
] as const satisfies readonly { value: HomeMode; label: string }[]

export function AppearanceSection() {
  const { theme, setTheme } = useThemeStore()
  const { mode, setMode } = useHomeModeStore()
  // Both stores persist to localStorage; wait for mount so SSR markup matches.
  const mounted = useMounted()

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Appearance</h2>
      <div className="grid min-h-[84px] grid-cols-[120px_1fr] items-center gap-y-2">
        {mounted && (
          <>
            <span className="text-text-secondary">Theme</span>
            <div>
              <Segmented options={themes} value={theme} onChange={setTheme} />
            </div>
            <span className="text-text-secondary">Home screen</span>
            <div>
              <Segmented options={homeModes} value={mode} onChange={setMode} />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
