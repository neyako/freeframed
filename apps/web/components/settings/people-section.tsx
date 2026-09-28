'use client'

import * as React from 'react'
import useSWR from 'swr'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { Avatar } from '@/components/shared/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { User } from '@/types'

type InvitedUser = User & { readonly invite_token: string | null }

const PEOPLE_KEY = '/users/people'

function statusLabel(person: User): string {
  if (person.is_superadmin) return 'Owner'
  switch (person.status) {
    case 'active':
      return 'Active'
    case 'pending_invite':
      return 'Invite pending'
    case 'deactivated':
      return 'Deactivated'
    case 'pending_verification':
      return 'Unverified'
  }
}

const rowButton = 'h-7 px-2.5'

export function PeopleSection() {
  const meId = useAuthStore((s) => s.user?.id)
  const { data: people, error: loadError, mutate } = useSWR<User[]>(PEOPLE_KEY, () =>
    api.get<User[]>(PEOPLE_KEY),
  )

  const [error, setError] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [toDeactivate, setToDeactivate] = React.useState<User | null>(null)

  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [inviting, setInviting] = React.useState(false)
  const [inviteLink, setInviteLink] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  function replacePerson(updated: User) {
    mutate((list) => list?.map((p) => (p.id === updated.id ? updated : p)), { revalidate: false })
  }

  async function deactivate(person: User) {
    setError('')
    try {
      replacePerson(await api.post<User>(`/users/${person.id}/deactivate`))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate')
    }
  }

  async function reactivate(person: User) {
    setError('')
    setBusyId(person.id)
    try {
      replacePerson(await api.post<User>(`/users/${person.id}/reactivate`))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reactivate')
    } finally {
      setBusyId(null)
    }
  }

  function toggleInvite() {
    setInviteOpen((v) => !v)
    setInviteLink(null)
    setCopied(false)
    setError('')
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return
    setInviting(true)
    setError('')
    try {
      const invited = await api.post<InvitedUser>('/users/invite', {
        email: trimmedEmail,
        name: name.trim() || trimmedEmail.split('@')[0],
      })
      setInviteLink(
        invited.invite_token ? `${window.location.origin}/invite/${invited.invite_token}` : null,
      )
      setEmail('')
      setName('')
      setInviteOpen(false)
      void mutate()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  async function copyLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center">
        <h2 className="font-medium">People</h2>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={toggleInvite}>
          <Plus className="h-3.5 w-3.5" />
          Invite
        </Button>
      </div>

      {inviteOpen && (
        <form onSubmit={handleInvite} className="flex flex-wrap gap-2">
          <div className="min-w-[180px] flex-1">
            <Input
              aria-label="Email"
              type="email"
              required
              autoFocus
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-[34px] text-[13px]"
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <Input
              aria-label="Name"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-[34px] text-[13px]"
            />
          </div>
          <Button type="submit" size="sm" disabled={inviting || !email.trim()}>
            {inviting ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
      )}

      {inviteLink && (
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              aria-label="Invite link"
              readOnly
              value={inviteLink}
              onFocus={(e) => e.target.select()}
              className="h-[34px] text-[13px] text-text-secondary"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={copyLink}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      )}

      {loadError ? (
        <p className="text-xs text-status-error">Couldn&apos;t load people.</p>
      ) : !people ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {people.map((person) => {
            const isMe = person.id === meId
            const deactivated = person.status === 'deactivated'
            return (
              <li
                key={person.id}
                className={cn('flex items-center gap-3 px-3 py-2.5', deactivated && 'text-text-tertiary')}
              >
                <Avatar src={person.avatar_url} name={person.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate">
                    {person.name}
                    {isMe && <span className="text-text-tertiary"> (you)</span>}
                  </div>
                  <div className="truncate text-xs text-text-secondary">{person.email}</div>
                </div>
                <span
                  className={cn(
                    'ml-auto shrink-0 text-xs',
                    person.status === 'pending_invite' && !person.is_superadmin
                      ? 'text-status-warning'
                      : 'text-text-secondary',
                  )}
                >
                  {statusLabel(person)}
                </span>
                {!isMe && person.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={rowButton}
                    onClick={() => setToDeactivate(person)}
                  >
                    Deactivate
                  </Button>
                )}
                {!isMe && deactivated && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={rowButton}
                    disabled={busyId === person.id}
                    onClick={() => reactivate(person)}
                  >
                    {busyId === person.id ? 'Reactivating…' : 'Reactivate'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="text-xs text-status-error">{error}</p>}
      <p className="text-xs text-text-tertiary">
        Deactivated people are signed out everywhere and can&apos;t sign in. Their comments stay.
      </p>

      <ConfirmDialog
        open={toDeactivate !== null}
        onOpenChange={(open) => !open && setToDeactivate(null)}
        title={`Deactivate ${toDeactivate?.name ?? ''}?`}
        description="They'll be signed out and can't sign in until reactivated."
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={() => (toDeactivate ? deactivate(toDeactivate) : undefined)}
      />
    </section>
  )
}
