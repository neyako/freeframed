import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import baseConfig from '../../tailwind.config'

async function compile(classes: string, input = '@tailwind utilities') {
  const result = await postcss([
    tailwindcss({
      ...baseConfig,
      content: [{ raw: `<div class="${classes}"></div>` }],
    }),
  ]).process(input, { from: undefined })
  return result.css
}

describe('token colors accept opacity modifiers', () => {
  it('compiles ring/bg/border modifiers on accent and status colors', async () => {
    const css = await compile(
      'ring-accent/20 bg-accent/10 border-accent/50 bg-status-error/10 bg-bg-elevated/90 bg-text-primary/30',
    )
    expect(css).toContain('ring-accent\\/20')
    expect(css).toContain('bg-accent\\/10')
    expect(css).toContain('border-accent\\/50')
    expect(css).toContain('bg-status-error\\/10')
    expect(css).toContain('bg-bg-elevated\\/90')
    expect(css).toContain('bg-text-primary\\/30')
    expect(css).toContain('--accent-rgb')
  })

  it('never emits the Tailwind default blue ring color', async () => {
    const css = await compile('ring-1 ring-2', '@tailwind base; @tailwind utilities')
    expect(css).toContain('--tw-ring-color: rgb(var(--accent-rgb) / 0.5)')
    expect(css).not.toContain('147 197 253')
    expect(css).not.toContain('59 130 246')
  })
})
