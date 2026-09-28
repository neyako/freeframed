'use client'

import * as React from 'react'
import { api } from '@/lib/api'
import { useBrandingStore } from '@/stores/branding-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type WorkspaceResponse = {
  readonly name: string
  readonly logo_dark: string | null
  readonly logo_light: string | null
}

export function WorkspaceNameSection() {
  const orgName = useBrandingStore((s) => s.orgName)
  const [name, setName] = React.useState(orgName)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  // Branding hydrates from the server after mount; follow it.
  React.useEffect(() => setName(orgName), [orgName])

  const trimmed = name.trim()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed || trimmed === orgName) return
    setSaving(true)
    setError('')
    try {
      const ws = await api.put<WorkspaceResponse>('/workspace', { name: trimmed })
      // The header reads the branding store, so this renames it in place.
      useBrandingStore.setState({
        orgName: ws.name,
        orgLogoDark: ws.logo_dark,
        orgLogoLight: ws.logo_light,
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rename workspace')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Workspace name</h2>
      <form onSubmit={handleSave} className="flex gap-2">
        <div className="flex-1">
          <Input
            aria-label="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-[34px] text-[13px]"
          />
        </div>
        <Button type="submit" size="sm" disabled={saving || !trimmed || trimmed === orgName}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {error && <p className="text-xs text-status-error">{error}</p>}
    </section>
  )
}
