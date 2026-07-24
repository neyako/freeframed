// Whether history-back will land somewhere inside this app.
//
// `history.length > 1` alone isn't enough: someone who pasted an asset URL over
// a foreign page has a history entry, but going back leaves the site. Requiring
// the referrer to be same-origin — or absent, which is what a fresh in-app load
// followed by client-side navigation looks like — keeps the user in the app.
//
// Returns false for the cases the deterministic fallback exists for: share-link
// redirects (location.replace leaves no entry), fresh tabs, and pasted URLs.
export function canGoBackInApp(
  history: { length: number },
  referrer: string,
  origin: string,
): boolean {
  if (history.length <= 1) return false
  if (referrer === '') return true
  // Compare parsed origins, not string prefixes: "http://localhost:30001"
  // starts with "http://localhost:3000".
  try {
    return new URL(referrer).origin === origin
  } catch {
    return false
  }
}
