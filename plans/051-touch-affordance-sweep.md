# Plan 051: Touch-affordance sweep — hover-revealed controls become visible on coarse pointers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 364e798..HEAD -- apps/web/tailwind.config.ts apps/web/components`
> The nine target files are listed in Scope; if any excerpt below no longer
> matches, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (executable in parallel with 047–050; does NOT touch `folder-share-viewer.tsx`)
- **Category**: bug (mobile UX)
- **Planned at**: commit `364e798`, 2026-07-03

## Why this matters

Controls across the app are hidden behind `opacity-0 group-hover:opacity-100`
— they materialize on mouse hover. Touch devices have no hover: phone users
cannot see (or discover) cancel-upload, remove-member, folder actions,
card action menus, selection checkboxes, or attachment buttons. The fix is a
`pointer-coarse` Tailwind variant so hover-revealed controls are simply always
visible on touch devices, with desktop behavior unchanged.

## Current state

The repo is Tailwind **3.4** (`apps/web/package.json`: `"tailwindcss": "^3.4.17"`).
Tailwind 3.x has no built-in `pointer-coarse:` variant (v4 added it), so this
plan adds one via a plugin in `apps/web/tailwind.config.ts`.

`apps/web/tailwind.config.ts` currently ends with (check the actual file —
it may already have a `plugins: []` array):

- a `plugins` key or none; the change is additive either way.

The 12 target occurrences (exact, at commit `364e798`):

| File | Line | Control hidden behind hover |
|------|------|------------------------------|
| `components/layout/uploads-panel.tsx` | 149 | cancel/remove upload buttons |
| `components/projects/project-members-dialog.tsx` | 395 | remove-member button |
| `components/projects/folder-tree.tsx` | 158 | folder action button |
| `components/projects/project-card.tsx` | 114 | project card action menu trigger |
| `components/projects/project-settings-dialog.tsx` | 107 | change-cover overlay |
| `components/projects/asset-grid.tsx` | 417 | folder selection checkbox (share mode) |
| `components/projects/asset-grid.tsx` | 456 | folder row actions (list view) |
| `components/projects/asset-grid.tsx` | 543 | asset selection checkbox (share mode) |
| `components/projects/asset-grid.tsx` | 586 | asset row actions (list view) |
| `components/projects/asset-card.tsx` | 170 | asset card action menu trigger |
| `components/projects/folder-card.tsx` | 181 | folder card action button |
| `components/review/comment-attachment.tsx` | 75 | attachment open/download overlay |

Example excerpt, `components/layout/uploads-panel.tsx:149`:

```tsx
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
```

Two of the twelve are conditional-class variants
(`asset-grid.tsx:417` and `:543`):

```tsx
                      isFolderSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
```

**Deliberately excluded**: `components/share/folder-share-viewer.tsx`
(3 hover-only spots) — plan 049 fixes those with an `md:` recipe to keep that
file single-owner. Do not touch it here.

Design constraint: plans 034–040 (pending monochrome retheme) restyle these
components' colors. This plan changes **visibility variants only** — no
color/radius/font edits. Plan 036 migrates `appearance-popover.tsx` /
uploads-bar internals — none of the 12 lines above are in its scope, but keep
your diff to exactly these class strings to avoid overlap.

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass            |
| Lint      | `pnpm lint`              | no new errors       |
| Build     | `pnpm build`             | exit 0 (proves the Tailwind plugin compiles) |

## Scope

**In scope** (the only files you should modify):

- `apps/web/tailwind.config.ts`
- The 9 component files in the table above (12 occurrences total)

**Out of scope** (do NOT touch):

- `apps/web/components/share/folder-share-viewer.tsx` (plan 049)
- Any other `hover:`-styled element that is merely *styled* on hover
  (color shifts etc.) — only `opacity-0 group-hover:opacity-100`
  reveal-gating is in scope.
- `globals.css`, colors, radii (retheme, plans 034–040).

## Git workflow

- Branch: `advisor/051-touch-affordance-sweep`
- Conventional commit, e.g. `fix(web): reveal hover-gated controls on touch devices`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Add the `pointer-coarse` variant

In `apps/web/tailwind.config.ts`, add a plugin (import `plugin` from
`tailwindcss/plugin` at the top):

```ts
import plugin from 'tailwindcss/plugin'
...
  plugins: [
    // existing plugins first, if any
    plugin(({ addVariant }) => {
      addVariant('pointer-coarse', '@media (pointer: coarse)')
    }),
  ],
```

**Verify**: `pnpm build` → exit 0.

### Step 2: Sweep the 12 occurrences

In each line from the table, extend the reveal classes with
`pointer-coarse:opacity-100`:

`opacity-0 group-hover:opacity-100` →
`opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100`

For the two conditional variants (`asset-grid.tsx:417`, `:543`) apply it to
the else-branch string:

```tsx
                      isFolderSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
```

Leave every other class on those lines untouched.

Note on the two dark overlays (`project-settings-dialog.tsx:107`,
`comment-attachment.tsx:75`): the overlay (`bg-black/40`–`/50`) becomes
permanently visible over the image on touch devices. That is the accepted
trade-off — reachable controls beat a clean thumbnail. Do not redesign them.

**Verify**:
`grep -rn "opacity-0 group-hover:opacity-100" apps/web/components --include="*.tsx" | grep -v folder-share-viewer | grep -v pointer-coarse` → 0 matches.

### Step 3: Full gate

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all
pass; `pnpm lint` → no new errors; `pnpm build` → exit 0.

Live check (only if dev stack running): in Chrome DevTools device emulation
(which reports `pointer: coarse`), project grid shows card action triggers
and share-mode checkboxes without hover; uploads drawer shows the ✕ buttons.
With emulation off, everything is hover-revealed as before.

## Test plan

No new unit tests — this is a CSS-variant sweep; JSDOM cannot exercise
`@media (pointer: coarse)`. Gate = grep anchor (Step 2) + build + existing
suite green + live check.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm build` exits 0
- [ ] `pnpm exec tsc --noEmit` exits 0 and `pnpm test` exits 0
- [ ] `grep -rn "opacity-0 group-hover:opacity-100" components --include="*.tsx" | grep -v folder-share-viewer | grep -v pointer-coarse` → empty
- [ ] `grep -c "pointer-coarse" tailwind.config.ts` → ≥1
- [ ] `git status --porcelain` shows only in-scope files (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `tailwind.config.ts` already defines a `pointer-coarse` (or equivalent)
  variant differently — reconcile instead of duplicating.
- An occurrence in the table no longer exists at (or near) the listed line —
  re-locate it by the class string within the same file; if the file no
  longer contains it at all, skip it and note that in your report.
- The repo has been migrated to Tailwind 4 (check `package.json`) — use the
  built-in `pointer-coarse:` variant and skip Step 1.

## Maintenance notes

- New hover-revealed controls should adopt the same triple:
  `opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100`. Consider a
  lint rule or a shared `cn` helper if the pattern keeps spreading.
- Plans 034–040 executors will restyle these components — the
  `pointer-coarse:opacity-100` token must survive those restyles; it is
  called out in the retheme's adjacent files.
- Deferred: `folder-share-viewer.tsx` hover spots (plan 049); hover-only
  tooltips (title attributes) are fine to leave — they duplicate visible
  icons.
