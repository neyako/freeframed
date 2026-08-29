import * as React from 'react'

/** True after first client render. Gate persisted-store reads that would
 * mismatch the server render (zustand persist hydrates after mount). */
export function useMounted(): boolean {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return mounted
}
