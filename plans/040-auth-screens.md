# Plan 040: Auth screens — wordmark hero, dot-grid backdrop, Doto code inputs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- "apps/web/app/(auth)/layout.tsx" apps/web/components/auth/login-form.tsx apps/web/components/auth/setup-wizard.tsx apps/web/components/auth/invite-accept.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW (isolated route group; inputs/buttons already restyled by 035)
- **Depends on**: plans/034-design-tokens-foundation.md, plans/035-primitive-components-restyle.md
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The login screen is the first thing every user and invited reviewer sees —
the natural place for the design's strongest identity moment. The design's
index page renders the brand as an oversized `freeframe` wordmark with the
final letter in red (`freeframe` + red `d`), on a dot-grid monochrome field.
Today the auth screens show a PNG logo over a blue radial glow with a glassy
shadowed card. Most of the interior already follows the system via plan 035's
Input/Button; this plan swaps the shell (backdrop, brand, card) and gives the
6-digit magic-code boxes the dot-matrix numeral treatment.

## Design spec (inline reference)

- Hero wordmark (design "Index / hub"): `font-sans` (Space Grotesk) weight
  500, tight tracking `-0.045em`, line-height ~0.86; mark text `freeframe`
  with a final `<span className="text-accent">d</span>` — i.e. renders
  "freeframed" with the trailing *d* red. At auth-card scale: ~40–48px.
- Backdrop: flat `bg-bg-primary` with the `.ff-dotgrid` texture (034); **no
  radial glow, no blur, no gradients**.
- Card/panel: `bg-bg-secondary border border-border rounded-lg p-6` — flat,
  hairline, no shadow, no translucency.
- Kicker line under/over the brand: `font-mono text-[11px] uppercase
  tracking-[0.2em] text-text-tertiary`, optionally with a 7px red dot.
- Numerals (magic code): Doto — `font-dot font-bold`.
- Headings inside steps: Space Grotesk 500, tight tracking; supporting copy
  `text-sm text-text-secondary`.
- Error banners: red is correct here (auth failure IS an interrupt):
  `border border-accent-line bg-accent-muted text-accent font-mono text-[12px]`.

## Current state

All excerpts at commit `39bdfc6`.

- `apps/web/app/(auth)/layout.tsx` (44 lines, full shell):
  ```tsx
  <div className="relative min-h-screen bg-bg-primary flex flex-col items-center justify-center px-4">
    {/* Subtle radial glow */}
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/3 ... h-[600px] w-[600px] rounded-full bg-accent/[0.04] blur-[120px]" />
    </div>
    {/* Logo */}
    <Image src="/logo-full.png" alt="FreeFrame" width={180} height={48} priority className="h-12 w-auto" />
    {/* Card */}
    <div className="relative w-full max-w-sm rounded-xl border border-border bg-bg-secondary/50 backdrop-blur-sm p-6 shadow-xl animate-fade-in">
      {children}
    </div>
    <p className="relative mt-8 text-2xs text-text-tertiary">Collaborative media review &amp; approval</p>
  </div>
  ```
- `apps/web/components/auth/login-form.tsx` (13.4K) — four steps
  (`email | code | password | classic`). Step headings like
  `<h1 className="text-xl font-semibold text-text-primary mb-1">Sign in to FreeF…` at
  lines ~234/285/329/385. Error banners:
  `rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2.5 text-sm text-status-error`.
  The 6-digit code inputs are individual `<input maxLength={1}>` boxes (line
  ~345 area) with auto-advance (`handleCodeChange`) and backspace handling —
  behavior must not change.
- `apps/web/components/auth/setup-wizard.tsx` (5.0K),
  `invite-accept.tsx` (6.0K) — same family; read before editing, conform with
  the same treatments (headings, error banners, spacing) — both compose
  `Input`/`Button` so most styling is inherited.
- `Image` from `next/image` is imported in the auth layout — remove the import
  if the logo goes.

## Commands you will need

| Purpose   | Command (run in `apps/web/`) | Expected on success |
|-----------|------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit`     | exit 0              |
| Tests     | `pnpm test`                  | 0 failed            |
| Lint      | `pnpm lint`                  | exit 0              |

## Scope

**In scope**:
- `apps/web/app/(auth)/layout.tsx`
- `apps/web/components/auth/login-form.tsx`
- `apps/web/components/auth/setup-wizard.tsx`
- `apps/web/components/auth/invite-accept.tsx`
- `apps/web/components/auth/__tests__/` (add/update)

**Out of scope** (do NOT touch):
- Auth logic: api calls, token handling (`lib/auth`), redirects, the
  code-input auto-advance/backspace/paste behavior.
- `public/logo-full.png` (file stays; only this layout stops using it).
- `middleware.ts`, `(auth)` routing.
- Branding-store — auth screens predate login; org branding intentionally
  doesn't apply here.

## Git workflow

- Branch: `advisor/040-auth-screens`
- Conventional commits, e.g. `feat(web): freeframed auth shell with wordmark and doto code inputs`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Auth shell — dot-grid field, flat card, wordmark hero

Rewrite `app/(auth)/layout.tsx` presentation:

- Root: `relative min-h-screen bg-bg-primary ff-dotgrid flex flex-col
  items-center justify-center px-4` — delete the radial-glow div entirely.
- Replace the `<Image>` logo block with the wordmark hero:
  ```tsx
  <div className="relative mb-10 flex flex-col items-center gap-3">
    <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-text-tertiary">
      <span className="h-[7px] w-[7px] rounded-full bg-accent" aria-hidden />
      Frame-accurate review
    </span>
    <h1 className="font-sans text-[44px] font-medium leading-[0.9] tracking-[-0.045em] text-text-primary">
      freeframe<span className="text-accent">d</span>
    </h1>
  </div>
  ```
  (drop the now-unused `next/image` import).
- Card: `relative w-full max-w-sm rounded-lg border border-border
  bg-bg-secondary p-6 animate-fade-in` (drop `/50`, `backdrop-blur-sm`,
  `shadow-xl`; opaque bg is required so the dot grid doesn't show through
  form fields).
- Footer line → `font-mono text-[10px] uppercase tracking-[0.16em]
  text-text-tertiary`.

**Verify**: `grep -c "logo-full\|blur-\|backdrop-blur" "app/(auth)/layout.tsx"` → 0;
`pnpm exec tsc --noEmit` → 0.

### Step 2: Login form — headings, errors, Doto code boxes

In `components/auth/login-form.tsx`:

- All step `<h1>`s → `text-xl font-medium tracking-[-0.02em] text-text-primary mb-1`
  (weight 600→500 per the design's display weight).
- All error banners (`border-status-error/30 bg-status-error/10
  text-status-error`, 4–5 occurrences) → `rounded border border-accent-line
  bg-accent-muted px-3 py-2.5 font-mono text-[12px] text-accent`.
- The six code `<input maxLength={1}>` boxes: set
  `font-dot text-2xl font-bold text-center text-text-primary` plus the plan-035
  field chrome (`rounded border border-border-strong bg-bg-secondary
  focus:border-accent focus:shadow-[inset_0_0_0_1px_var(--accent)]
  focus:outline-none`). Keep every handler and `inputMode`/`maxLength`
  attribute exactly as-is.
- Step-switch links ("Sign in with password instead", "Resend code", etc.) →
  `font-mono text-[11px] uppercase tracking-[0.1em] text-text-secondary
  hover:text-text-primary`.

**Verify**: `grep -c "status-error" components/auth/login-form.tsx` → 0;
`pnpm test` → 0 failed.

### Step 3: Setup wizard + invite accept

Read both files; apply the same three treatments (headings → weight 500
tracked; error banners → accent-muted mono; secondary links → mono uppercase).
Both compose `Input`/`Button`, so expect ~10-line diffs each. Do not alter
step logic or validation.

**Verify**: `grep -c "status-error" components/auth/setup-wizard.tsx components/auth/invite-accept.tsx` → 0 per file; `pnpm exec tsc --noEmit` → 0.

### Step 4: Full gate

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```

Visual smoke (`pnpm dev`, logged out): `/login` — dot-grid field, wordmark
with red *d*, flat card; email → code step shows Doto digits; error state
shows the red mono banner; check light theme and a 360px viewport (wordmark
must not overflow — if it does, add `text-[38px]` below `sm`).

## Test plan

- New: `components/auth/__tests__/auth-shell.test.tsx` — render the login
  page's layout (or `LoginForm` inside a minimal wrapper): assert the
  wordmark text "freeframe" + a `text-accent` "d" span exist; assert entering
  an invalid email surfaces the error banner element (behavior already
  covered if `components/auth/__tests__` has a login test — extend rather than
  duplicate; check that directory first).
- Existing suite: `pnpm test` → 0 failed.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 0 failed; wordmark test added/extended and passing
- [ ] `grep -c "ff-dotgrid" "app/(auth)/layout.tsx"` → 1
- [ ] `grep -c "logo-full" "app/(auth)/layout.tsx"` → 0
- [ ] `grep -rc "status-error" components/auth/*.tsx` → 0 per file
- [ ] `grep -c "font-dot" components/auth/login-form.tsx` → ≥1
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- 034/035 not landed (`grep -c "D71921" app/globals.css` → 0, or Input still
  has the old `focus:ring-2` treatment) — the shell would half-adopt.
- The auth layout no longer matches the Current state excerpt (drift).
- Any auth test fails for a non-class reason after your edits (you touched
  behavior — revert and retry with classes only).
- The maintainer's deployments rely on `/logo-full.png` at auth via branding
  requirements you can see referenced elsewhere (grep `logo-full` repo-wide
  first; at `39bdfc6` the auth layout is the only consumer).

## Maintenance notes

- The auth shell is now the canonical "brand moment" — if marketing/branding
  later wants the org logo on auth, gate it behind the branding store the way
  `header.tsx` does (plan 037), keeping the wordmark as fallback.
- Doto code boxes: digits render dot-matrix; if a user reports the code being
  hard to read, drop `font-dot` on the inputs only (they're the one place
  Doto renders *input* rather than display text — a deliberate flourish).
- Reviewer scrutiny: dot-grid behind the card in **light theme** — `--dot` is
  `#d4cfc0`; confirm the texture is subtle, not noisy, at 100% zoom.
