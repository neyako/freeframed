'use client'

import * as React from 'react'
import { getAccessToken } from '@/lib/auth'

// ─── Event payload types ──────────────────────────────────────────────────────

export interface TranscodeProgressEvent {
  asset_id: string
  percent: number
}

export interface TranscodeCompleteEvent {
  asset_id: string
  version_id: string
}

export interface TranscodeFailedEvent {
  asset_id: string
  error: string
}

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface UseSSEOptions {
  onTranscodeProgress?: (data: TranscodeProgressEvent) => void
  onTranscodeComplete?: (data: TranscodeCompleteEvent) => void
  onTranscodeFailed?: (data: TranscodeFailedEvent) => void
  enabled?: boolean
}

type SSECallbacks = Omit<UseSSEOptions, 'enabled'>

// ─── Constants ────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]

// Named SSE event → callback it feeds.
const EVENT_CALLBACKS = {
  transcode_progress: 'onTranscodeProgress',
  transcode_complete: 'onTranscodeComplete',
  transcode_failed: 'onTranscodeFailed',
} as const satisfies Record<string, keyof SSECallbacks>

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSSE(projectId: string | null | undefined, options: UseSSEOptions = {}): void {
  const { enabled = true, ...callbacks } = options

  // Stable callback refs so reconnects don't need to re-register handlers
  const callbackRefs = React.useRef<SSECallbacks>(callbacks)

  React.useEffect(() => {
    callbackRefs.current = callbacks
  })

  React.useEffect(() => {
    if (!enabled || !projectId) return

    let es: EventSource | null = null
    let retryIndex = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    function connect() {
      if (destroyed) return

      const token = getAccessToken()
      // Use window.location.origin as a base so deployments behind a reverse
      // proxy can set NEXT_PUBLIC_API_URL to a relative path like "/api"
      // without crashing the URL constructor.
      const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      const url = new URL(`${API_URL}/events/${projectId}`, base)
      if (token) {
        url.searchParams.set('token', token)
      }

      es = new EventSource(url.toString(), { withCredentials: true })

      es.onopen = () => {
        retryIndex = 0 // reset backoff on successful connection
      }

      es.onerror = () => {
        if (destroyed) return
        es?.close()
        es = null

        // Exponential backoff reconnect
        const delay = BACKOFF_STEPS[Math.min(retryIndex, BACKOFF_STEPS.length - 1)]
        retryIndex++
        retryTimer = setTimeout(connect, delay)
      }

      for (const [type, callbackName] of Object.entries(EVENT_CALLBACKS)) {
        es.addEventListener(type, (e: MessageEvent) => {
          if (destroyed) return
          try {
            const callback = callbackRefs.current[callbackName] as ((data: unknown) => void) | undefined
            callback?.(JSON.parse(e.data))
          } catch {
            // ignore malformed events
          }
        })
      }
    }

    connect()

    return () => {
      destroyed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      es?.close()
    }
  }, [projectId, enabled])
}
