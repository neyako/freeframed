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
    'flex flex-col items-center gap-1.5 px-3.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors'
  const active = 'text-accent'
  const inactive = 'text-text-tertiary hover:text-text-secondary'

  const projectsActive = pathname.startsWith('/projects')
  const profileActive = pathname.startsWith('/settings')

  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-border bg-bg-primary/90 px-2 pt-2.5 pb-3.5 lg:hidden">
      <Link href="/projects" className={cn(tab, projectsActive ? active : inactive)}>
        <FolderOpen className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Projects
      </Link>
      <button type="button" onClick={onSearchOpen} className={cn(tab, inactive)}>
        <Search className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Search
      </button>
      <button type="button" onClick={togglePanel} className={cn(tab, inactive)}>
        <Upload className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Uploads
      </button>
      <Link href="/settings/profile" className={cn(tab, profileActive ? active : inactive)}>
        <User className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Profile
      </Link>
    </nav>
  )
}
