// Shared avatar helpers for review surfaces (comment panel + scrubber markers).

// Built at runtime: the TS target (ES5) rejects the u flag in a literal
const WORD = new RegExp('[\\p{L}\\p{N}]+', 'gu')

export function getInitials(name: string): string {
  // Words only: "Mai (Acme)" is MA, not M(; any script's letters and digits count
  const parts: string[] = name.match(WORD) ?? []
  if (parts.length === 0) return '?'
  const first = parts[0]!.charAt(0)
  if (parts.length === 1) return first.toUpperCase()
  return (first + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

// Monochrome avatar ramp — neutral grays keep reviewers distinguishable without
// reintroducing color into the mono+red design system. All shades take white text.
const AVATAR_GRAYS = ['#3f3f46', '#52525b', '#5f6068', '#71717a']

export function avatarGray(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_GRAYS[Math.abs(hash) % AVATAR_GRAYS.length]
}
