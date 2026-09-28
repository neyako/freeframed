'use client'

import { useAuthStore } from '@/stores/auth-store'
import { WorkspaceNameSection } from '@/components/settings/workspace-name-section'
import { PeopleSection } from '@/components/settings/people-section'
import { ProfileSection } from '@/components/settings/profile-section'
import { AppearanceSection } from '@/components/settings/appearance-section'

export default function SettingsPage() {
  const isOwner = useAuthStore((s) => s.user?.is_superadmin ?? false)

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-8 px-5 py-8 text-[13px] text-text-primary">
      <h1 className="text-lg font-semibold">Settings</h1>
      {isOwner && <WorkspaceNameSection />}
      {isOwner && <PeopleSection />}
      <ProfileSection />
      <AppearanceSection />
    </div>
  )
}
