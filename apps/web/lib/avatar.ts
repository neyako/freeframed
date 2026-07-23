// Shared avatar helpers for review surfaces (comment panel + scrubber markers).

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0].charAt(0) || '?').toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
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
