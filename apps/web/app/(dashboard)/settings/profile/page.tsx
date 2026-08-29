'use client'

import * as React from 'react'
import { User } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/shared/avatar'
import { Camera, Loader2, X } from 'lucide-react'

export default function ProfilePage() {
  const { user, fetchUser } = useAuthStore()

  const [name, setName] = React.useState(user?.name ?? '')
  const [isSavingProfile, setIsSavingProfile] = React.useState(false)
  const [profileError, setProfileError] = React.useState('')
  const [profileSuccess, setProfileSuccess] = React.useState(false)

  // Avatar upload state
  const avatarInputRef = React.useRef<HTMLInputElement>(null)
  const [avatarUrl, setAvatarUrl] = React.useState(user?.avatar_url ?? null)
  const [isUploadingAvatar, setIsUploadingAvatar] = React.useState(false)
  React.useEffect(() => {
    setAvatarUrl(user?.avatar_url ?? null)
  }, [user?.avatar_url])

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setProfileError('')
    if (!file.type.startsWith('image/')) {
      setProfileError('Avatar must be an image (PNG, JPEG, or WebP)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError('Avatar must be under 5 MB')
      return
    }
    setIsUploadingAvatar(true)
    try {
      const { upload_url, key } = await api.post<{ upload_url: string; key: string }>(
        '/users/avatar-upload',
        { content_type: file.type },
      )
      const res = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!res.ok) throw new Error('Failed to upload avatar')
      const updated = await api.put<{ avatar_url: string | null }>('/users/avatar', { key })
      setAvatarUrl(updated.avatar_url)
      await fetchUser()
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to upload avatar')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  async function handleAvatarRemove() {
    setProfileError('')
    setIsUploadingAvatar(true)
    try {
      await api.delete<void>('/users/avatar')
      setAvatarUrl(null)
      await fetchUser()
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to remove avatar')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [isSavingPassword, setIsSavingPassword] = React.useState(false)
  const [passwordError, setPasswordError] = React.useState('')
  const [passwordSuccess, setPasswordSuccess] = React.useState(false)

  // Sync name when user loads
  React.useEffect(() => {
    if (user?.name) setName(user.name)
  }, [user?.name])

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault()
    setProfileError('')
    setProfileSuccess(false)
    if (!name.trim()) {
      setProfileError('Name is required')
      return
    }
    setIsSavingProfile(true)
    try {
      await api.patch(`/users/${user?.id}`, { name: name.trim() })
      await fetchUser()
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save profile'
      setProfileError(message)
    } finally {
      setIsSavingProfile(false)
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setIsSavingPassword(true)
    try {
      await api.patch('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess(true)
      setTimeout(() => setPasswordSuccess(false), 3000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to change password'
      setPasswordError(message)
    } finally {
      setIsSavingPassword(false)
    }
  }

  return (
    <div className="p-6 max-w-xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-muted">
          <User className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Profile</h1>
          <p className="text-sm text-text-secondary">
            Manage your profile and account settings
          </p>
        </div>
      </div>

      {/* Profile section */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
          Profile
        </h2>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar src={avatarUrl} name={user?.name} size="lg" />
            <button
              type="button"
              aria-label="Upload avatar"
              onClick={() => avatarInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            >
              {isUploadingAvatar
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Camera className="h-3 w-3" />}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {user?.name ?? 'Loading...'}
            </p>
            <p className="text-xs text-text-tertiary">{user?.email ?? ''}</p>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="text-2xs text-accent hover:underline disabled:opacity-50"
              >
                Upload avatar
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleAvatarRemove}
                  disabled={isUploadingAvatar}
                  className="inline-flex items-center gap-0.5 text-2xs text-text-tertiary hover:text-text-primary disabled:opacity-50"
                >
                  <X className="h-2.5 w-2.5" />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-xs font-medium text-text-secondary">
              Full Name
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-text-secondary">
              Email
            </label>
            <Input
              id="email"
              value={user?.email ?? ''}
              disabled
              className="opacity-60 cursor-not-allowed"
            />
            <p className="text-2xs text-text-tertiary">
              Email cannot be changed. Contact your admin for help.
            </p>
          </div>

          {profileError && (
            <p className="text-xs text-status-error">{profileError}</p>
          )}
          {profileSuccess && (
            <p className="text-xs text-status-success">Profile saved successfully.</p>
          )}

          <Button type="submit" variant="primary" size="sm" loading={isSavingProfile}>
            Save Profile
          </Button>
        </form>
      </section>

      {/* Password section */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
          Change Password
        </h2>

        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="currentPassword" className="text-xs font-medium text-text-secondary">
              Current Password
            </label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="newPassword" className="text-xs font-medium text-text-secondary">
              New Password
            </label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 characters"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="text-xs font-medium text-text-secondary">
              Confirm New Password
            </label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />
          </div>

          {passwordError && (
            <p className="text-xs text-status-error">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="text-xs text-status-success">Password changed successfully.</p>
          )}

          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={isSavingPassword}
          >
            Change Password
          </Button>
        </form>
      </section>
    </div>
  )
}
