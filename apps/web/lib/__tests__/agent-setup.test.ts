import { describe, expect, it } from 'vitest'
import { agentSetupPrompt } from '../agent-setup'

const base = { name: 'Claude', token: 'ffd_abc', origin: 'http://192.168.1.20:8080' }

describe('agentSetupPrompt', () => {
  it('installs ffd from the same-origin API in the all-in-one layout', () => {
    const prompt = agentSetupPrompt({ ...base, apiUrl: '/api' })
    expect(prompt).toContain('curl -fsSL http://192.168.1.20:8080/api/cli/ffd -o ~/.local/bin/ffd')
    expect(prompt).toContain('ffd login --url http://192.168.1.20:8080 --token ffd_abc\n')
    expect(prompt).toContain('ffd guide')
  })

  it('points ffd at a separate API host when there is one', () => {
    const prompt = agentSetupPrompt({ ...base, origin: 'http://localhost:3000', apiUrl: 'http://localhost:8000' })
    expect(prompt).toContain('curl -fsSL http://localhost:8000/cli/ffd')
    expect(prompt).toContain('--token ffd_abc --api-url http://localhost:8000')
  })
})
