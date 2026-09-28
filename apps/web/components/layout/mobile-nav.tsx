'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderOpen, Search, Upload, User } from 'lucide-react'
import { useUploadStore } from '@/stores/upload-store'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  onSearchOpen: () => void
}

export function MobileNav({ onSearchOpen }: MobileNavProps) {
  const pathname = usePathname()
  const { togglePanel } = useUploadStore()

  const tab =
    'flex flex-col items-center gap-1 px-3.5 py-1 text-[11px] transition-colors duration-100'
  const active = 'text-text-primary'
  const inactive = 'text-text-tertiary hover:text-text-secondary'

  const projectsActive = pathname.startsWith('/projects')
  const profileActive = pathname.startsWith('/settings')

  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-border bg-bg-primary px-2 pb-3 pt-2 lg:hidden">
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
