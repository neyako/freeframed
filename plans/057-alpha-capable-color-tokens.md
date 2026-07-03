# Plan 057: Make token colors alpha-capable so opacity modifiers compile (kills the blue focus ring)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 955feed..HEAD -- apps/web/tailwind.config.ts apps/web/app/globals.css`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED (visual blast radius: ~100 previously-dead utility classes start rendering)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `955feed`, 2026-07-03

## Why this matters

The app's Tailwind colors are defined as plain CSS-variable strings
(`accent: 'var(--accent)'`). Tailwind v3 cannot inject an opacity into a
color it can't parse, so **every class with an opacity modifier on a token
color — `bg-accent/10`, `ring-accent/20`, `border-accent/50`, etc. — silently
compiles to nothing**. A census at `955feed` found ~100 such dead classes
across 43 files. Two user-visible consequences: (1) the comment input's focus
treatment (`focus-within:ring-accent/20`) doesn't exist, so the bare
`focus-within:ring-1` falls back to **Tailwind's default blue**
`rgb(59 130 246 / 0.5)` — a blue focus ring in a strictly monochrome+red
design; (2) all accent tints/washes the retheme authors wrote are invisible.
This plan fixes the root cause once, in config — zero call-site edits — so
every one of those classes compiles with its author-intended value.

## Current state

- `apps/web/tailwind.config.ts` — lines 33–65 define all colors as plain
  `var(...)` strings:

  ```ts
  colors: {
    bg: {
      primary: 'var(--bg-primary)',
      secondary: 'var(--bg-secondary)',
      tertiary: 'var(--bg-tertiary)',
      elevated: 'var(--bg-elevated)',
      hover: 'var(--bg-hover)',
    },
    // ... border, text, accent, status — same pattern
  }
  ```

- `apps/web/app/globals.css` — token values live in two theme blocks:
  `:root, [data-theme="dark"]` (starts ~line 5) and `[data-theme="light"]`
  (starts ~line 50). Dark values: `--bg-primary: #000000`,
  `--bg-secondary: #0a0a0a`, `--bg-tertiary: #131313`,
  `--bg-elevated: #181818`, `--text-primary: #f4f4f4`,
  `--accent: #D71921`, `--status-error: #D71921`,
  `--status-success: #f4f4f4`. Light values: `--bg-primary: #f1efe9`,
  `--bg-secondary: #eae7df`, `--bg-tertiary: #e2ded4`,
  `--bg-elevated: #f7f5f0`, `--text-primary: #0a0a0a`, `--accent: #D71921`,
  `--status-error: #D71921`, `--status-success: #0a0a0a`.

- `apps/web/components/review/comment-input.tsx:406` — the reported blue
  focus ring:

  ```tsx
  <div className="flex items-start gap-0 rounded-lg border border-border bg-bg-tertiary focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20">
  ```

  Verified in the running app: the compiled CSS contains **no**
  `.focus-within\:ring-accent\/20` or `.focus-within\:border-accent\/50`
  rule, and a probe element with `ring-1` computes
  `--tw-ring-color: rgb(59 130 246 / 0.5)`.

- Colors actually used with `/NN` modifiers in `components/` + `app/`
  (census, distinct base colors): `accent`, `status-error`, `status-success`,
  `bg-primary`, `bg-secondary`, `bg-tertiary`, `bg-elevated`,
  `text-primary`. Only these eight need channel variables.

- Design-canon note (from the maintainer's Claude Design project
  `freeframe.css`): the input focus treatment is red, never blue —
  `.ff-input:focus { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }`.
  This plan restores the red via the authored `ring-accent/20`; exact
  conformance to the inset recipe is deferred (see Maintenance notes).

- Tailwind version: `3.4.17` (`apps/web/package.json`) — supports the
  `<alpha-value>` placeholder and `rgb(R G B / <alpha-value>)` color syntax.

## Commands you will need

Run all in `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm exec tsc --noEmit` | 0 errors            |
| Tests     | `pnpm test`              | 0 failed (≥164 pass at plan time) |
| Build     | `pnpm build`             | exit 0              |

Package manager is **pnpm only** — never `npm install` (creates a divergent
lockfile; see `AGENTS.md`).

## Scope

**In scope** (the only files you should modify):
- `apps/web/app/globals.css` (add channel variables)
- `apps/web/tailwind.config.ts` (alpha-capable color definitions + default ring color)
- `apps/web/components/__tests__/tailwind-color-alpha.test.ts` (create)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- Any `.tsx` call site using `/NN` classes — the whole point is that they
  start working unchanged. Do not "clean them up".
- `components/review/comment-input.tsx` — its classes become correct once
  the config compiles them.
- `--accent-muted` / `--accent-line` and every other token not in the
  eight-color list — they stay plain `var()` hex/rgba.
- `postcss.config.js`, font config, radius/shadow scales.

## Git workflow

- Branch: `advisor/057-alpha-capable-color-tokens`
- Conventional commits with scope, e.g.
  `fix(web): alpha-capable color tokens — opacity modifiers compile, focus ring red`
- Do NOT push or open a PR.

## Steps

### Step 1: Add RGB channel variables to both theme blocks in `globals.css`

In `apps/web/app/globals.css`, add to the **dark** block
(`:root, [data-theme="dark"]`), next to the existing color tokens:

```css
  /* RGB channel twins — keep in sync with the hex tokens above.
     Only tokens used with Tailwind opacity modifiers need a twin. */
  --bg-primary-rgb: 0 0 0;
  --bg-secondary-rgb: 10 10 10;
  --bg-tertiary-rgb: 19 19 19;
  --bg-elevated-rgb: 24 24 24;
  --text-primary-rgb: 244 244 244;
  --accent-rgb: 215 25 33;
  --status-success-rgb: 244 244 244;
  --status-error-rgb: 215 25 33;
```

And to the **light** block (`[data-theme="light"]`):

```css
  --bg-primary-rgb: 241 239 233;
  --bg-secondary-rgb: 234 231 223;
  --bg-tertiary-rgb: 226 222 212;
  --bg-elevated-rgb: 247 245 240;
  --text-primary-rgb: 10 10 10;
  --accent-rgb: 215 25 33;
  --status-success-rgb: 10 10 10;
  --status-error-rgb: 215 25 33;
```

(These are the exact decimal conversions of the hex tokens listed in
"Current state". If the hex values in the file differ from those listed,
STOP — the palette drifted.)

**Verify**: `grep -c "rgb:" apps/web/app/globals.css` → `16`

### Step 2: Make the eight colors alpha-capable in `tailwind.config.ts`

In the `colors` block, change **only** the eight entries (leave `bg.hover`,
all `border.*`, `text.secondary/tertiary/inverse`, `accent.hover/muted/line`,
`status.warning/info` as plain `var()` strings):

```ts
colors: {
  bg: {
    primary: 'rgb(var(--bg-primary-rgb) / <alpha-value>)',
    secondary: 'rgb(var(--bg-secondary-rgb) / <alpha-value>)',
    tertiary: 'rgb(var(--bg-tertiary-rgb) / <alpha-value>)',
    elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
    hover: 'var(--bg-hover)',
  },
  border: { /* unchanged */ },
  text: {
    primary: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
    secondary: 'var(--text-secondary)',
    tertiary: 'var(--text-tertiary)',
    inverse: 'var(--text-inverse)',
  },
  accent: {
    DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
    hover: 'var(--accent-hover)',
    muted: 'var(--accent-muted)',
    line: 'var(--accent-line)',
  },
  status: {
    success: 'rgb(var(--status-success-rgb) / <alpha-value>)',
    warning: 'var(--status-warning)',
    error: 'rgb(var(--status-error-rgb) / <alpha-value>)',
    info: 'var(--status-info)',
  },
},
```

Also add, inside the same `extend` block (sibling of `colors`), the default
ring color so any bare `ring-N` is red, never Tailwind blue:

```ts
ringColor: {
  DEFAULT: 'var(--border-focus)',
},
```

**Verify**: `pnpm exec tsc --noEmit` → 0 errors

### Step 3: Add a compile-canary test

Create `apps/web/components/__tests__/tailwind-color-alpha.test.ts`:

```ts
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import baseConfig from '../../tailwind.config'

async function compile(classes: string) {
  const result = await postcss([
    tailwindcss({
      ...baseConfig,
      content: [{ raw: `<div class="${classes}"></div>` }],
    }),
  ]).process('@tailwind utilities', { from: undefined })
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
    const css = await compile('ring-1 ring-2')
    expect(css).not.toContain('59 130 246')
  })
})
```

`postcss` and `tailwindcss` are already direct devDependencies of
`apps/web` — no new packages. Model the file header/style on the existing
`apps/web/components/__tests__/switch.test.tsx`.

**Verify**: `pnpm test` → 0 failed, total ≥ 166 (the 2 new tests pass)

### Step 4: Build and probe the compiled CSS

Run `pnpm build`, then:

- `grep -rl "ring-accent\\\\/20" .next/static/css/` → at least one file
- `grep -rl "59 130 246" .next/static/css/` → **no matches** (the default
  blue is gone). If matches remain, inspect: if they come from the ring
  DEFAULT not applying, STOP and report the offending rule.

**Verify**: both greps as stated; `pnpm build` exit 0

### Step 5: Visual spot-check (report, don't judge alone)

If a dev stack is reachable (`http://localhost:3000` — the maintainer
usually has `docker compose -f docker-compose.dev.yml up` running; otherwise
`pnpm dev`), open an asset review page, focus the comment box, and confirm
the focus edge/glow is **red**, not blue. Include in your report a list of
the surfaces you eyeballed (comment input focus, comment panel highlight,
asset-grid selection wash) and anything that now renders a tint that looks
wrong — the reviewer decides; do not revert individual call sites yourself.

**Verify**: focused comment input shows a red (not blue) border/ring.

## Test plan

- New file `apps/web/components/__tests__/tailwind-color-alpha.test.ts`
  (Step 3): two cases — modifiers compile for every base color in the
  census's eight; default blue ring color is never emitted.
- Existing suite must stay green: `pnpm test` → 0 failed. The retheme's
  component tests assert class strings, not compiled CSS, so they are not
  expected to change. If any existing test fails, STOP — do not edit
  existing tests to make them pass.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` → 0 errors
- [ ] `pnpm test` → 0 failed; the 2 new canary tests pass
- [ ] `pnpm build` → exit 0
- [ ] `grep -c "rgb:" app/globals.css` → 16
- [ ] `grep -c "<alpha-value>" tailwind.config.ts` → 8
- [ ] `grep -rl "59 130 246" .next/static/css/` → no matches (after build)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The hex token values in `globals.css` differ from the ones listed in
  "Current state" (palette drifted — channel twins would be wrong).
- The canary test fails after Step 2 is in place (the `<alpha-value>`
  mechanism isn't working — likely a Tailwind version/config subtlety; do
  not downgrade or patch node_modules).
- After Step 4, `59 130 246` still appears in built CSS.
- Any existing test fails.
- You find yourself wanting to edit any `.tsx` file.

## Maintenance notes

- **Sync rule**: the `*-rgb` twins must change whenever their hex tokens
  change. The comment added in Step 1 marks this; a reviewer should check
  both when the palette moves.
- **Future colors**: an opacity modifier on a token *without* a channel twin
  still silently compiles to nothing (e.g. `bg-bg-hover/50`). If a new
  `/NN` usage appears in review, either add its twin + extend the canary
  test, or use a discrete token.
- **Deferred conformance**: the design's canonical input focus is
  `border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent)`
  (`.ff-input:focus` in the design project's `freeframe.css`). Call sites
  keep their authored red-glow (`ring-accent/20`) for now; sweeping them to
  the inset recipe is a separate, optional pass.
- ~100 formerly-dead classes now render. The reviewer should skim the
  executor's Step-5 surface list for any wash that reads as noise in the
  monochrome design — each such site is a one-line class fix, on request.
