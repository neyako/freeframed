'use client'

import { useEffect } from 'react'

/**
 * Sets the browser tab title. Appends " – freeframed" suffix.
 * Pass null/undefined to reset to default "freeframed".
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} – freeframed` : 'freeframed'
    return () => { document.title = 'freeframed' }
  }, [title])
}
