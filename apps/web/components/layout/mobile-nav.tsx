'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FolderOpen, Inbox, Search, Upload, User } from 'lucide-react'
import { useUploadStore } from '@/stores/upload-store'
import { useHomeModeStore } from '@/stores/home-mode-store'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  onSearchOpen: () => void
}

export function MobileNav({ onSearchOpen }: MobileNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { togglePanel } = useUploadStore()
  const setHomeMode = useHomeModeStore((s) => s.setMode)

  // The active tab gets a short red bar on top: red marks "you are here"
  const tab =
    'relative flex flex-col items-center gap-1 px-3 py-1 text-[11px] transition-colors duration-100'
  const active =
    "text-text-primary before:absolute before:-top-2 before:left-1/2 before:h-0.5 before:w-4 before:-translate-x-1/2 before:bg-accent before:content-['']"
  const inactive = 'text-text-tertiary hover:text-text-secondary'

  const reviewActive = pathname === '/'
  const projectsActive = pathname.startsWith('/projects')
  const profileActive = pathname.startsWith('/settings')

  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-border bg-bg-primary px-2 pb-3 pt-2 lg:hidden">
      {/* Review is a home mode; opening it makes it home again, like the
          desktop toggle on the projects page */}
      <button
        type="button"
        onClick={() => {
          setHomeMode('review')
          router.push('/')
        }}
        className={cn(tab, reviewActive ? active : inactive)}
      >
        <Inbox className="h-5 w-5" strokeWidth={1.75} />
        Review
      </button>
      <Link href="/projects" className={cn(tab, projectsActive ? active : inactive)}>
        <FolderOpen className="h-5 w-5" strokeWidth={1.75} />
        Projects
      </Link>
      <button type="button" onClick={onSearchOpen} className={cn(tab, inactive)}>
        <Search className="h-5 w-5" strokeWidth={1.75} />
        Search
      </button>
      <button type="button" onClick={togglePanel} className={cn(tab, inactive)}>
        <Upload className="h-5 w-5" strokeWidth={1.75} />
        Uploads
      </button>
      <Link href="/settings" className={cn(tab, profileActive ? active : inactive)}>
        <User className="h-5 w-5" strokeWidth={1.75} />
        Profile
      </Link>
    </nav>
  )
}
