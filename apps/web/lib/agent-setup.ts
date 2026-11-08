export interface AgentInfo {
  preset: string
  name: string
  avatar_url: string
  connected_at: string | null
}

/** Absolute API base as an agent machine must reach it. */
export function absoluteApiUrl(apiUrl: string, origin: string): string {
  return (apiUrl.startsWith('/') ? origin + apiUrl : apiUrl).replace(/\/$/, '')
}

/**
 * What the owner pastes into an agent: install ffd from this freeframed,
 * log in, then load the review-loop guide as a skill.
 */
export function agentSetupPrompt(opts: { name: string; token: string; origin: string; apiUrl: string }): string {
  const api = absoluteApiUrl(opts.apiUrl, opts.origin)
  const apiFlag = api === `${opts.origin}/api` ? '' : ` --api-url ${api}`
  return [
    'Set up freeframed so you can send me video cuts for review.',
    '',
    '1. Install the ffd CLI (needs python3):',
    '   mkdir -p ~/.local/bin',
    `   curl -fsSL ${api}/cli/ffd -o ~/.local/bin/ffd && chmod +x ~/.local/bin/ffd`,
    '   Make sure ~/.local/bin is on PATH.',
    `2. Connect as ${opts.name}:`,
    `   ffd login --url ${opts.origin} --token ${opts.token}${apiFlag}`,
    '3. Run `ffd guide` and save its output as a skill named freeframed-review',
    "   (or as standing instructions if you don't have skills). Follow it",
    '   whenever I ask you to send a cut for review.',
  ].join('\n')
}
