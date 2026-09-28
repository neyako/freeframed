'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  dialogCloseClass,
  dialogContentClass,
  dialogOverlayClass,
  dialogTitleClass,
} from '@/components/ui/surface'
import { Avatar } from '@/components/shared/avatar'
import { CopyButton } from '@/components/review/share-link-control-primitives'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import type { ProjectRole, User } from '@/types'

interface ProjectMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
}

interface MemberWithUser {
  id: string
  user_id: string
  role: ProjectRole
  user: User
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function AddMember({
  projectId,
  members,
  onMemberAdded,
}: {
  projectId: string
  members: MemberWithUser[]
  onMemberAdded: () => void
}) {
  const [query, setQuery] = React.useState('')
  const [suggestions, setSuggestions] = React.useState<User[]>([])
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [inviteLink, setInviteLink] = React.useState<string | null>(null)
  const email = query.trim()
  // No account yet: invite by email, which creates a pending account the
  // editor activates through the invite link. Only the workspace owner
  // (superadmin) can create accounts.
  const isWorkspaceOwner = useAuthStore((s) => s.user?.is_superadmin ?? false)
  const canInvite = isWorkspaceOwner && !selectedUser && EMAIL_PATTERN.test(email)
    && !suggestions.some((u) => u.email.toLowerCase() === email.toLowerCase())

  // Debounced user search, excluding existing members
  React.useEffect(() => {
    if (selectedUser || query.length < 1) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const users = await api.get<User[]>(`/users/search?q=${encodeURIComponent(query)}`)
        const existing = new Set(members.map((m) => m.user_id))
        setSuggestions(users.filter((u) => !existing.has(u.id)))
      } catch {
        setSuggestions([])
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, selectedUser, members])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser && !canInvite) return
    setAdding(true)
    setError(null)
    setInviteLink(null)
    try {
      let userId = selectedUser?.id
      if (!userId) {
        const invited = await api.post<User & { invite_token: string | null }>('/users/invite', {
          email,
          name: email.split('@')[0],
        })
        userId = invited.id
        if (invited.invite_token) {
          setInviteLink(`${window.location.origin}/invite/${invited.invite_token}`)
        }
      }
      await api.post(`/projects/${projectId}/members`, { user_id: userId, role: 'editor' })
      setSelectedUser(null)
      setQuery('')
      onMemberAdded()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add editor')
    } finally {
      setAdding(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedUser(null)
            setError(null)
          }}
          placeholder="Name or email"
          aria-label="Name or email"
          className="h-[30px] min-w-0 flex-1 rounded-md border border-border-strong bg-bg-secondary px-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary transition-colors duration-100 focus:border-text-primary/60 focus:outline-none"
        />
        <Button type="submit" size="sm" disabled={!selectedUser && !canInvite} loading={adding}>
          {canInvite ? 'Invite' : 'Add'}
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-md border border-border">
          {suggestions.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedUser(user)
                setQuery(user.name || user.email)
                setSuggestions([])
              }}
              className="flex h-9 w-full items-center gap-2 px-2 text-left text-[13px] transition-colors duration-100 hover:bg-bg-hover"
            >
              <Avatar name={user.name} src={user.avatar_url} size="sm" />
              <span className="truncate text-text-primary">{user.name}</span>
              <span className="truncate text-text-tertiary">{user.email}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[12px] text-status-error">{error}</p>}

      {inviteLink && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={inviteLink}
            aria-label="Invite link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-[34px] min-w-0 flex-1 rounded-md border border-border bg-bg-primary px-2.5 font-mono text-[12px] text-text-secondary outline-none"
          />
          <CopyButton text={inviteLink} disabled={false} />
        </div>
      )}
    </form>
  )
}

export function ProjectMembersDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ProjectMembersDialogProps) {
  const [members, setMembers] = React.useState<MemberWithUser[]>([])
  const [loading, setLoading] = React.useState(false)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [removeError, setRemoveError] = React.useState<string | null>(null)
  const { user } = useAuthStore()

  const fetchMembers = React.useCallback(async () => {
    setLoading(true)
    try {
      const rawMembers = await api.get<{ id: string; user_id: string; role: ProjectRole }[]>(
        `/projects/${projectId}/members`,
      )
      if (rawMembers.length === 0) {
        setMembers([])
        return
      }
      const users = await api.get<User[]>(`/users?ids=${rawMembers.map((m) => m.user_id).join(',')}`)
      const userMap = new Map(users.map((u) => [u.id, u]))
      setMembers(
        rawMembers
          .filter((m) => userMap.has(m.user_id))
          .map((m) => ({ ...m, user: userMap.get(m.user_id)! })),
      )
    } catch {
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (open) {
      setRemoveError(null)
      fetchMembers()
    }
  }, [open, fetchMembers])

  async function handleRemove(userId: string) {
    setRemoving(userId)
    setRemoveError(null)
    try {
      await api.delete(`/projects/${projectId}/members/${userId}`)
      await fetchMembers()
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Could not remove member')
    } finally {
      setRemoving(null)
    }
  }

  const isOwner = members.some((m) => m.user_id === user?.id && m.role === 'owner')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={cn(dialogContentClass, 'max-w-md')}>
          <Dialog.Close className={dialogCloseClass} aria-label="Close">
            <X />
          </Dialog.Close>
          <Dialog.Title className={cn(dialogTitleClass, 'pr-8 truncate')}>
            Members of {projectName}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-text-secondary">
            Editors upload versions and comment. New emails get an invite link.
          </Dialog.Description>

          <div className="mt-3">
            <AddMember projectId={projectId} members={members} onMemberAdded={fetchMembers} />
          </div>

          <div className="mt-3 max-h-[320px] divide-y divide-border overflow-y-auto border-t border-border">
            {loading && members.length === 0 ? (
              <p className="py-3 text-[13px] text-text-tertiary">Loading…</p>
            ) : (
              members.map((m) => {
                const isCurrentUser = m.user_id === user?.id
                return (
                  <div key={m.id} className="flex items-center gap-2.5 py-2">
                    <Avatar name={m.user.name} src={m.user.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-text-primary">
                        {m.user.name}
                        {isCurrentUser && <span className="text-text-tertiary"> (you)</span>}
                      </p>
                      <p className="truncate text-[12px] text-text-tertiary">{m.user.email}</p>
                    </div>
                    <span className="text-[12px] text-text-secondary">
                      {m.role === 'owner' ? 'Owner' : 'Editor'}
                    </span>
                    {isOwner && !isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 hover:text-accent"
                        onClick={() => handleRemove(m.user_id)}
                        disabled={removing === m.user_id}
                        aria-label={`Remove ${m.user.name}`}
                      >
                        {removing === m.user_id ? 'Removing…' : 'Remove'}
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </div>
          {removeError && <p className="mt-2 text-[12px] text-status-error">{removeError}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
