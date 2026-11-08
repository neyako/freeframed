'use client'

import * as React from 'react'
import useSWR from 'swr'
import { api } from '@/lib/api'
import { agentSetupPrompt, type AgentInfo } from '@/lib/agent-setup'
import { formatRelativeTime } from '@/lib/utils'
import { Avatar } from '@/components/shared/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const AGENTS_KEY = '/agents'
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const rowButton = 'h-7 px-2.5'

interface TokenResponse {
  agent: AgentInfo
  token: string
}

/** Preset AI agents that upload cuts and babysit their review through ffd. */
export function AgentsSection() {
  const { data: agents, error: loadError, mutate } = useSWR<AgentInfo[]>(AGENTS_KEY, () =>
    api.get<AgentInfo[]>(AGENTS_KEY),
  )
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [setup, setSetup] = React.useState<{ preset: string; prompt: string } | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [toRemove, setToRemove] = React.useState<AgentInfo | null>(null)

  async function issue(agent: AgentInfo, path: string) {
    setError('')
    setBusy(agent.preset)
    try {
      const res = await api.post<TokenResponse>(path)
      setSetup({
        preset: agent.preset,
        prompt: agentSetupPrompt({
          name: res.agent.name,
          token: res.token,
          origin: window.location.origin,
          apiUrl: API_URL,
        }),
      })
      setCopied(false)
      void mutate()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setBusy(null)
    }
  }

  async function remove(agent: AgentInfo) {
    setError('')
    try {
      await api.delete(`${AGENTS_KEY}/${agent.preset}`)
      if (setup?.preset === agent.preset) setSetup(null)
      void mutate()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  async function copySetup() {
    if (!setup) return
    await navigator.clipboard.writeText(setup.prompt)
    setCopied(true)
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">Agents</h2>

      {loadError ? (
        <p className="text-xs text-status-error">Couldn&apos;t load agents.</p>
      ) : !agents ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {agents.map((agent) => {
            const connected = agent.connected_at !== null
            const working = busy === agent.preset
            return (
              <li key={agent.preset}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar src={agent.avatar_url} name={agent.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{agent.name}</div>
                    {connected && (
                      <div className="truncate text-xs text-text-secondary">
                        Connected {formatRelativeTime(agent.connected_at!)}
                      </div>
                    )}
                  </div>
                  {connected ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={rowButton}
                        disabled={working}
                        onClick={() => issue(agent, `${AGENTS_KEY}/${agent.preset}/token`)}
                      >
                        New token
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`${rowButton} text-accent hover:bg-accent-muted`}
                        onClick={() => setToRemove(agent)}
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className={rowButton}
                      disabled={working}
                      onClick={() => issue(agent, `${AGENTS_KEY}/${agent.preset}`)}
                    >
                      {working ? 'Connecting…' : 'Connect'}
                    </Button>
                  )}
                </div>
                {setup && setup.preset === agent.preset && (
                  <div className="space-y-2 border-t border-border bg-bg-secondary px-3 py-3">
                    <p className="text-xs text-text-secondary">
                      Paste this into {agent.name}. The token is shown once.
                    </p>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed text-text-primary">
                      {setup.prompt}
                    </pre>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={copySetup}>
                        {copied ? 'Copied' : 'Copy setup'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSetup(null)}>
                        Done
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="text-xs text-status-error">{error}</p>}

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title={`Remove ${toRemove?.name ?? ''}?`}
        description="Its token stops working. Its uploads and comments stay."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => (toRemove ? remove(toRemove) : undefined)}
      />
    </section>
  )
}
