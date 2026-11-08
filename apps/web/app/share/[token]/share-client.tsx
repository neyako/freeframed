'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/shared/wordmark'
import { FolderShareViewer, ShareReviewScreen } from '@/components/share/folder-share-viewer'
import type { Asset, SharePermission, ShareLinkAppearance } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShareValidateResponse {
  asset?: Asset
  asset_id?: string | null
  folder_id?: string | null
  folder_name?: string
  title?: string
  description?: string | null
  permission?: SharePermission
  allow_download?: boolean
  show_versions?: boolean
  show_watermark?: boolean
  appearance?: ShareLinkAppearance | null
  visibility?: string
  requires_password?: boolean
  requires_auth?: boolean
  share_session?: string | null
  expired?: boolean
  created_by_name?: string | null
  viewer_name?: string | null
  viewer_email?: string | null
  internal_url?: string | null
  error?: string
}

// ─── Utility ──────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function fetchShareInfo(
  token: string,
  password?: string,
): Promise<ShareValidateResponse> {
  // Header, not query string, so the password stays out of access logs
  const response = await fetch(`${API_URL}/share/${token}`, {
    credentials: 'include',
    headers: password ? { 'X-Share-Password': password } : undefined,
  })
  if (!response.ok) {
    if (response.status === 403) {
      const data = await response.json().catch(() => ({}))
      if (data.detail === 'Incorrect password') {
        return { requires_password: true, error: 'Incorrect password' }
      }
      return { requires_password: true }
    }
    if (response.status === 410) return { expired: true }
    return {}
  }
  return response.json()
}

// ─── Password gate ────────────────────────────────────────────────────────────

interface PasswordGateProps {
  onSubmit: (password: string) => void
  error?: string | null
  loading?: boolean
}

function PasswordGate({ onSubmit, error, loading }: PasswordGateProps) {
  const [password, setPassword] = React.useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.trim()) onSubmit(password.trim())
  }

  return (
    <GateScreen title="This link has a password" note="Ask the person who sent it.">
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password…"
            autoFocus
            className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
          />
          {error && <p className="text-xs text-status-error">{error}</p>}
          <Button type="submit" size="sm" className="w-full" loading={loading}>
            Open
          </Button>
        </form>
    </GateScreen>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

interface ErrorStateProps {
  expired?: boolean
}

function ErrorState({ expired }: ErrorStateProps) {
  return (
    <GateScreen
      title={expired ? 'This link has expired' : 'This link doesn\u2019t work'}
      note={expired ? 'Ask the sender for a new one.' : 'It may have been turned off. Ask the sender for a new one.'}
    />
  )
}

/** Plain full-page notice for guests: the mark, one line, one action */
function GateScreen({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-[320px]">
        <Wordmark className="text-[14px]" />
        <h1 className="mt-8 text-[20px] font-semibold tracking-[-0.015em] text-text-primary">{title}</h1>
        {note && <p className="mt-1.5 text-[13px] text-text-secondary">{note}</p>}
        {children}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SharePageClient({
  token,
}: {
  token: string
}) {

  type PageState =
    | { stage: 'loading' }
    | { stage: 'password_required'; error?: string; loading?: boolean }
    | { stage: 'expired' }
    | { stage: 'invalid' }
    | { stage: 'auth_required'; title?: string }
    | {
        stage: 'ready'
        asset: Asset & { thumbnail_url?: string; stream_url?: string }
        permission: SharePermission
        allowDownload: boolean
        showVersions: boolean
        viewerName: string | null
        watermark: string | null
      }
    | {
        stage: 'folder_ready'
        folderName: string
        title: string
        description: string | null
        createdByName: string | null
        viewerName: string | null
        permission: SharePermission
        allowDownload: boolean
        showVersions: boolean
        appearance: ShareLinkAppearance
        watermark: string | null
      }

  const [state, setState] = React.useState<PageState>({ stage: 'loading' })
  const [shareSession, setShareSession] = React.useState<string | null>(null)
  const refreshTried = React.useRef(false)

  async function validate(password?: string) {
    if (password) {
      setState({ stage: 'password_required', loading: true })
    }
    try {
      let data = await fetchShareInfo(token, password)

      // The httpOnly access cookie may have expired while the refresh cookie is
      // still valid. The dashboard refreshes on 401, but this public endpoint
      // answers 200 with a guest view instead — so a logged-in team member would
      // silently land in the guest player. Refresh once and re-validate before
      // treating the viewer as a guest; for real guests the refresh just 401s.
      if (
        !password &&
        !refreshTried.current &&
        !data.requires_password &&
        !data.expired &&
        (data.requires_auth || (data.permission && !data.internal_url))
      ) {
        refreshTried.current = true
        const refreshed = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => null)
        if (refreshed?.ok) data = await fetchShareInfo(token)
      }
      if (data.requires_auth) {
        setState({ stage: 'auth_required', title: data.title })
        return
      }
      if (data.requires_password) {
        setState({ stage: 'password_required', error: data.error || undefined })
        return
      }
      if (data.expired) {
        setState({ stage: 'expired' })
        return
      }
      if (!data.permission) {
        setState({ stage: 'invalid' })
        return
      }

      // Team members land in the editor viewport; ?as_guest=1 previews the guest view
      if (
        data.internal_url &&
        new URLSearchParams(window.location.search).get('as_guest') !== '1'
      ) {
        window.location.replace(data.internal_url)
        return
      }

      // Store share session from password-protected link validation
      if (data.share_session) {
        setShareSession(data.share_session)
      }

      // Fallback watermark text: the signed-in viewer, else the link title.
      // Guests who gave a name/email when commenting override it in the viewer.
      const watermark = data.show_watermark
        ? data.viewer_email || data.viewer_name || data.title || 'Confidential'
        : null

      // Folder share mode
      if (data.folder_id && !data.asset_id) {
        const defaultAppearance: ShareLinkAppearance = {
          layout: 'grid',
          theme: 'dark',
          accent_color: null,
          open_in_viewer: true,
          sort_by: 'created_at',
          card_size: 'm',
          aspect_ratio: 'landscape',
          thumbnail_scale: 'fill',
          show_card_info: true,
        }
        const folderName = data.folder_name ?? 'Shared'
        setState({
          stage: 'folder_ready',
          folderName,
          title: data.title ?? folderName,
          description: data.description ?? null,
          createdByName: data.created_by_name ?? null,
          viewerName: data.viewer_name ?? null,
          permission: data.permission,
          allowDownload: data.allow_download ?? false,
          showVersions: data.show_versions ?? true,
          appearance: { ...defaultAppearance, ...(data.appearance ?? {}) },
          watermark,
        })
        return
      }

      // Standard asset share mode
      if (!data.asset) {
        setState({ stage: 'invalid' })
        return
      }
      setState({
        stage: 'ready',
        asset: data.asset,
        permission: data.permission,
        allowDownload: data.allow_download ?? false,
        showVersions: data.show_versions ?? true,
        viewerName: data.viewer_name ?? null,
        watermark,
      })
    } catch {
      setState({ stage: 'invalid' })
    }
  }

  React.useEffect(() => {
    validate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (state.stage === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <span className="text-[13px] text-text-tertiary">Loading…</span>
      </div>
    )
  }

  if (state.stage === 'password_required') {
    return (
      <PasswordGate
        onSubmit={(pw) => validate(pw)}
        error={state.error}
        loading={state.loading}
      />
    )
  }

  if (state.stage === 'expired') {
    return <ErrorState expired />
  }

  if (state.stage === 'invalid') {
    return <ErrorState />
  }

  if (state.stage === 'auth_required') {
    return (
      <GateScreen title={state.title || 'Sign in to open this link'} note="It's shared with accounts only.">
        <a
          // Come back to this link after signing in
          href={`/login?from=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}
          className="mt-5 inline-flex h-[34px] w-full items-center justify-center rounded-md bg-text-primary text-[13px] font-medium text-text-inverse hover:opacity-90 transition-opacity"
        >
          Sign in
        </a>
      </GateScreen>
    )
  }

  if (state.stage === 'folder_ready') {
    return (
      <FolderShareViewer
        token={token}
        shareSession={shareSession}
        folderName={state.folderName}
        title={state.title}
        description={state.description}
        createdByName={state.createdByName}
        viewerName={state.viewerName}
        permission={state.permission}
        allowDownload={state.allowDownload}
        showVersions={state.showVersions}
        appearance={state.appearance}
        watermark={state.watermark}
      />
    )
  }

  return (
    <ShareReviewScreen
      token={token}
      shareSession={shareSession}
      assetId={state.asset.id}
      assetName={state.asset.name}
      viewerName={state.viewerName}
      permission={state.permission}
      allowDownload={state.allowDownload}
      watermark={state.watermark}
    />
  )
}
