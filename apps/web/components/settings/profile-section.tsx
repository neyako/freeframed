'use client'

import * as React from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { Avatar } from '@/components/shared/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const fieldClass = 'h-[34px] text-[13px]'

export function ProfileSection() {
  const { user, fetchUser } = useAuthStore()
  const [error, setError] = React.useState('')

  const [name, setName] = React.useState(user?.name ?? '')
  const [savingName, setSavingName] = React.useState(false)
  React.useEffect(() => {
    if (user?.name) setName(user.name)
  }, [user?.name])

  const avatarInputRef = React.useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = React.useState(false)

  const trimmedName = name.trim()

  async function handleNameSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !trimmedName || trimmedName === user.name) return
    setError('')
    setSavingName(true)
    try {
      await api.patch(`/users/${user.id}`, { name: trimmedName })
      await fetchUser()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save name')
    } finally {
      setSavingName(false)
    }
  }

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (!file.type.startsWith('image/')) {
      setError('Avatar must be an image (PNG, JPEG, or WebP)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Avatar must be under 5 MB')
      return
    }
    setAvatarBusy(true)
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
      await api.put('/users/avatar', { key })
      await fetchUser()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload avatar')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function handleAvatarRemove() {
    setError('')
    setAvatarBusy(true)
    try {
      await api.delete<void>('/users/avatar')
      await fetchUser()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove avatar')
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Profile</h2>
      <div className="grid grid-cols-[120px_1fr] items-center gap-y-2">
        <span className="text-text-secondary">Name</span>
        <form onSubmit={handleNameSave} className="flex gap-2">
          <div className="flex-1">
            <Input
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={savingName || !trimmedName || trimmedName === user?.name}
          >
            {savingName ? 'Saving…' : 'Save'}
          </Button>
        </form>

        <span className="text-text-secondary">Avatar</span>
        <div className="flex items-center gap-2">
          <Avatar src={user?.avatar_url} name={user?.name} size="md" />
          <Button
            variant="secondary"
            size="sm"
            disabled={avatarBusy}
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatarBusy ? 'Uploading…' : 'Change'}
          </Button>
          {user?.avatar_url && (
            <Button variant="ghost" size="sm" disabled={avatarBusy} onClick={handleAvatarRemove}>
              Remove
            </Button>
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleAvatarFile}
          />
        </div>

        <span className="text-text-secondary">Password</span>
        <PasswordField />
      </div>
      {error && <p className="text-xs text-status-error">{error}</p>}
    </section>
  )
}

function PasswordField() {
  const [open, setOpen] = React.useState(false)
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [done, setDone] = React.useState(false)

  function close() {
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setError('')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!current || !next || !confirm) return setError('All fields are required')
    if (next.length < 8) return setError('Password must be at least 8 characters')
    if (next !== confirm) return setError('Passwords do not match')
    setSaving(true)
    try {
      await api.patch('/auth/change-password', { current_password: current, new_password: next })
      close()
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setDone(false)
            setOpen(true)
          }}
        >
          Change
        </Button>
        {done && <span className="text-xs text-text-secondary">Password changed.</span>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-2">
      <Input
        aria-label="Current password"
        type="password"
        placeholder="Current password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        className={fieldClass}
      />
      <Input
        aria-label="New password"
        type="password"
        placeholder="New password (8+ characters)"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        className={fieldClass}
      />
      <Input
        aria-label="Confirm new password"
        type="password"
        placeholder="Confirm new password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className={fieldClass}
      />
      {error && <p className="text-xs text-status-error">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
