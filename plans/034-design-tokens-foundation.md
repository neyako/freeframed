# Plan 034: Adopt the "freeframed" design tokens — monochrome canvas, red interrupt, new fonts, squared radii

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- apps/web/app/globals.css apps/web/tailwind.config.ts apps/web/app/layout.tsx`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (app-wide visual change, but token-indirected — no component APIs change)
- **Depends on**: none
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The maintainer designed a new visual identity for FreeFrame in Claude Design
("FreeFrame Design System", https://claude.ai/design/p/00498290-d48e-4d5b-a733-c0a800031b92):
a Nothing-OS-inspired monochrome UI — OLED-black canvas (warm off-white in light
mode), **red `#D71921` as the single accent/"interrupt"**, Space Grotesk for
display/body, Space Mono for uppercase labels, the dot-matrix font **Doto for
numerals**, near-square radii (0–4 px), hairline borders instead of shadows, and
a signature dot-grid texture. All three fonts cover the Vietnamese subset (the
product is used bilingually EN/VI).

This plan is the foundation: the app already routes all colors through CSS
variables in `globals.css` whose **names exactly match the new design's tokens**
(`--bg-primary`, `--text-secondary`, `--accent`, …), and Tailwind maps those
vars to utilities. Swapping the variable values, overriding the Tailwind
radius/shadow scales, and switching the fonts rethemes ~80% of the app in one
change. Plans 035–040 then restyle individual components on top of this.

## Current state

- `apps/web/app/globals.css` — token definitions. Dark theme (default) currently:
  ```css
  :root,
  [data-theme="dark"] {
    --bg-primary: #0d0d10;         /* → becomes #000000 */
    ...
    --border-focus: #5b8def;       /* blue accent today */
    ...
    --accent: #5b8def;
    --accent-hover: #7aa3f5;
    --accent-muted: #253556;
    --status-success: #34d399;     /* green/yellow/red/blue status set */
    ...
    --font-sans: var(--font-geist), system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
    ...
    --radius-sm: 4px;  --radius-md: 6px;  --radius-lg: 8px;  --radius-xl: 12px;
  }
  [data-theme="light"] { --bg-primary: #ffffff; ... }
  ```
  Note `--font-geist` is a dead reference — the actual font is DM Sans, injected
  by `app/layout.tsx` as the `--font-sans` variable on `<body>` (which shadows
  the `:root` value for all descendants).
- `apps/web/tailwind.config.ts` — maps the vars to utilities
  (`colors.bg.primary: 'var(--bg-primary)'`, `colors.accent`, `colors.status.*`,
  `fontFamily.sans/mono`). **It does not override `borderRadius` or `boxShadow`**,
  so `rounded-md`, `rounded-xl`, `shadow-lg` etc. use Tailwind's stock values —
  those must be overridden here to re-square/flatten the whole app (99 uses of
  `rounded-md/lg/xl`, 65 uses of `shadow-*` in `apps/web`).
- `apps/web/app/layout.tsx` — loads DM Sans:
  ```tsx
  import { DM_Sans } from "next/font/google";
  const dmSans = DM_Sans({ subsets: ["latin"], display: "swap",
    variable: "--font-sans", weight: ["400", "500", "600", "700"], preload: true });
  ...
  <body className={`${dmSans.variable} font-sans antialiased`}>
  ```
  and has an inline pre-paint theme script reading the `ff-theme` localStorage
  key (zustand persist JSON) — **do not touch that script**, the theme mechanism
  (`data-theme` attribute, `stores/theme-store.ts`, `components/shared/theme-initializer.tsx`)
  stays exactly as-is. `viewport.themeColor` is `"#0A0A0B"`.
- Fonts available in this Next version (14.2.35, checked in
  `node_modules/.../next/dist/compiled/@next/font/dist/google/index.d.ts`):
  `Space_Grotesk` (subsets incl. `'vietnamese'`, variable weight) and
  `Space_Mono` (subsets incl. `'vietnamese'`, weight `'400' | '700'`) exist;
  **`Doto` does NOT exist in this Next version's Google-font list** — it must be
  loaded with `next/font/local` from a committed woff2 file.
- Tests currently green: `pnpm test` → 136 passed (136) across 19 files.
  Two tests assert class names that survive this plan unchanged:
  `components/__tests__/button.test.tsx:14` expects `bg-accent` (accent just
  changes color), `components/__tests__/skeleton.test.tsx:11` expects a
  `rounded-xl` class to exist (the class name stays; only its computed value
  changes via the config override).

## Design token reference (source of truth — copy values from here)

The design system's full token set. Dark is the default; light is a warm
off-white. `--status-*` mappings are this plan's decision (the design is
monochrome + red only; see Maintenance notes):

```css
/* ─── Dark (OLED black, default) ─── */
:root,
[data-theme="dark"] {
  --bg-primary: #000000;
  --bg-secondary: #0a0a0a;
  --bg-tertiary: #131313;
  --bg-elevated: #181818;
  --bg-hover: #1e1e1e;

  --border-primary: #292929;
  --border-secondary: #1a1a1a;
  --border-strong: #3d3d3d;      /* NEW token */
  --border-focus: #D71921;

  --text-primary: #f4f4f4;
  --text-secondary: #9b9b9b;
  --text-tertiary: #5a5a5a;
  --text-inverse: #000000;

  --accent: #D71921;
  --accent-hover: #ff2b35;
  --accent-muted: rgba(215, 25, 33, 0.14);
  --accent-line: rgba(215, 25, 33, 0.30);   /* NEW token */

  --dot: #1c1c1c;                 /* NEW: dot-grid texture color */
  --scrim: rgba(0, 0, 0, 0.72);   /* NEW: poster/photo scrim */

  /* Monochrome status mapping — red is the sole interrupt */
  --status-success: #f4f4f4;
  --status-warning: #9b9b9b;
  --status-error: #D71921;
  --status-info: #9b9b9b;

  --font-sans: var(--font-space-grotesk), system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-space-mono), ui-monospace, 'SFMono-Regular', monospace;
  --font-dot: var(--font-doto), var(--font-space-grotesk), sans-serif;  /* NEW */

  --radius-sm: 0px;
  --radius-md: 2px;
  --radius-lg: 3px;
  --radius-xl: 4px;
}

/* ─── Light (warm off-white) ─── */
[data-theme="light"] {
  --bg-primary: #f1efe9;
  --bg-secondary: #eae7df;
  --bg-tertiary: #e2ded4;
  --bg-elevated: #f7f5f0;
  --bg-hover: #ded9cd;

  --border-primary: #cfcabb;
  --border-secondary: #ddd8cb;
  --border-strong: #b0aa98;
  --border-focus: #D71921;

  --text-primary: #0a0a0a;
  --text-secondary: #57544c;
  --text-tertiary: #8b877a;
  --text-inverse: #f1efe9;

  --accent: #D71921;
  --accent-hover: #b3141b;
  --accent-muted: rgba(215, 25, 33, 0.10);
  --accent-line: rgba(215, 25, 33, 0.28);

  --dot: #d4cfc0;
  --scrim: rgba(20, 18, 14, 0.55);

  --status-success: #0a0a0a;
  --status-warning: #57544c;
  --status-error: #D71921;
  --status-info: #57544c;
}
```

Keep the existing `--space-unit: 4px` line. Keep `--text-inverse`.

## Commands you will need

| Purpose   | Command (run in `apps/web/`)   | Expected on success |
|-----------|--------------------------------|---------------------|
| Install   | `pnpm install`                 | exit 0 (already installed) |
| Typecheck | `pnpm exec tsc --noEmit`       | exit 0, no output   |
| Tests     | `pnpm test`                    | 136 passed (136), 19 files |
| Lint      | `pnpm lint`                    | exit 0 (pre-existing warnings OK) |
| Build     | `pnpm build`                   | exit 0 — **this is the only gate that validates next/font config** |
| Dev       | `pnpm dev`                     | serves on :3000 for visual check |

## Scope

**In scope** (the only files you should modify/create):
- `apps/web/app/globals.css`
- `apps/web/tailwind.config.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/fonts/doto-variable.woff2` (create — binary font file)

**Out of scope** (do NOT touch, even though they look related):
- Any component file (`components/**`) — plans 035–040 handle components.
- `stores/theme-store.ts`, `components/shared/theme-initializer.tsx`, the
  inline theme script in `layout.tsx` — theme switching mechanism is unchanged.
- `apps/web/public/logo-*.png` — logo/brand assets are handled in plan 037.
- The API (`apps/api`) and everything outside `apps/web`.

## Git workflow

- Branch: `advisor/034-design-tokens-foundation`
- Conventional commits, e.g. `feat(web): adopt freeframed design tokens and fonts`
  (matches repo style: `fix(web): keep share revoke dialog mounted`)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Download the Doto variable font

Doto is not in Next 14.2's built-in Google-font list, and FreeFrame is deployed
self-hosted/offline, so the font file must be committed and served locally:

```bash
cd apps/web && mkdir -p app/fonts
WOFF2=$(curl -s -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' \
  'https://fonts.googleapis.com/css2?family=Doto:wght@100..900&display=swap' \
  | grep -o 'https://fonts.gstatic.com/[^)]*\.woff2' | head -1)
echo "$WOFF2" && curl -s "$WOFF2" -o app/fonts/doto-variable.woff2
ls -la app/fonts/
```

**Verify**: `file app/fonts/doto-variable.woff2` → mentions "Web Open Font Format"
(or at minimum the file is >10 KB, not an HTML error page). Then confirm git will
track it: `git check-ignore app/fonts/doto-variable.woff2; echo "ignored=$?"` →
`ignored=1` (i.e. NOT ignored — this repo has surprising `.gitignore` entries;
plan 022 previously hit an ignored `lib/`). If it IS ignored, add a negation
entry to `apps/web/.gitignore` rather than moving the file.

### Step 2: Switch fonts in `app/layout.tsx`

Replace the DM Sans setup with Space Grotesk + Space Mono (Google, build-time
self-hosted by next/font) and Doto (local):

```tsx
import { Space_Grotesk, Space_Mono } from "next/font/google";
import localFont from "next/font/local";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-space-grotesk",
});
const spaceMono = Space_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-space-mono",
});
const doto = localFont({
  src: "./fonts/doto-variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-doto",
  preload: false, // numerals-only accent font; don't block first paint
});
```

Body: `className={`${spaceGrotesk.variable} ${spaceMono.variable} ${doto.variable} font-sans antialiased`}`.
Important: the old `dmSans` used `variable: "--font-sans"`, which shadowed the
`:root` `--font-sans` — the new setup uses **distinct variable names** and lets
`globals.css` compose the semantic vars (Step 3). Also change
`viewport.themeColor` from `"#0A0A0B"` to `"#000000"`. Do not touch the inline
theme `<script>`.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 3: Replace token values in `app/globals.css`

Replace the entire `:root, [data-theme="dark"]` and `[data-theme="light"]`
blocks with the token reference above (keeping `--space-unit: 4px`). Then in the
same file:

- `::selection` → `background-color: var(--accent); color: #fff;`
- Scrollbar thumb: `border-radius: 0;` (was 3px).
- `.glass-card` (kept for compatibility): change to flat —
  `@apply rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)];`
  (drop `backdrop-blur-md shadow-lg`, drop `rounded-xl`).
- Add the design's signature texture as component classes at the end of
  `@layer components`:
  ```css
  /* Dot-grid texture (design-system signature) */
  .ff-dotgrid {
    background-image: radial-gradient(var(--dot) 1.1px, transparent 1.2px);
    background-size: 15px 15px;
    background-position: -1px -1px;
  }
  ```
- Keep the `.logo-dark`/`.logo-light` switching rules and `.focus-ring` as-is
  (focus ring color follows `--accent` automatically).

**Verify**: `grep -c "D71921" app/globals.css` → ≥ 4;
`grep -c "5b8def\|34d399\|fbbf24\|0d0d10" app/globals.css` → 0.

### Step 4: Override Tailwind scales in `tailwind.config.ts`

Inside `theme.extend` (colors/fonts) and `theme` (radius/shadow — full override,
not extend):

```ts
theme: {
  // FULL overrides — kill stock roundness and shadows app-wide
  borderRadius: {
    none: '0px',
    sm: 'var(--radius-sm)',      // 0px
    DEFAULT: 'var(--radius-md)', // 2px
    md: 'var(--radius-md)',      // 2px
    lg: 'var(--radius-lg)',      // 3px
    xl: 'var(--radius-xl)',      // 4px
    '2xl': 'var(--radius-xl)',
    '3xl': 'var(--radius-xl)',
    full: '9999px',              // circles (avatars, dots, pills) stay round
  },
  boxShadow: {
    sm: '0 0 #0000', DEFAULT: '0 0 #0000', md: '0 0 #0000',
    lg: '0 0 #0000', xl: '0 0 #0000', '2xl': '0 0 #0000',
    inner: '0 0 #0000', none: '0 0 #0000',
  },
  extend: {
    colors: {
      // ...existing entries stay; ADD:
      border: { /* keep DEFAULT/secondary/focus */ strong: 'var(--border-strong)' },
      accent: { /* keep DEFAULT/hover/muted */ line: 'var(--accent-line)' },
    },
    fontFamily: {
      sans: ['var(--font-sans)'],
      mono: ['var(--font-mono)'],
      dot: ['var(--font-dot)'],   // NEW — dot-matrix numerals
    },
    animation: { /* keep existing; ADD: */ blink: 'blink 1.4s steps(1) infinite' },
    keyframes: { /* keep existing; ADD: */ blink: { '50%': { opacity: '0.25' } } },
  },
}
```

Note `boxShadow` values must be `'0 0 #0000'` (not `'none'`) so Tailwind's
ring utilities, which compose through the same `box-shadow` property, keep
working. `ring-*` classes are unaffected by this override.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 5: Full gate + visual smoke

```bash
pnpm test        # → 136 passed (136)
pnpm lint        # → exit 0 (pre-existing warnings only)
pnpm build       # → exit 0  (validates font subsets + local font path)
```

Then `pnpm dev`, open http://localhost:3000/login and (after logging in if a
dev API is available — optional) /projects. Expect: pure-black background, red
accents where blue was, DM Sans replaced by Space Grotesk, visibly squarer
corners, no drop shadows. Toggle light theme in Settings → Appearance (or set
`document.documentElement.dataset.theme='light'` in the console): warm
off-white canvas, same red accent.

## Test plan

No new test files — this plan is token/config only. The existing suite is the
regression net:

- `pnpm test` → 136 passed (136). If `button.test.tsx` or `skeleton.test.tsx`
  fail, you broke the class-name contract (see Current state) — fix the config,
  not the tests.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 136 passed (136)
- [ ] `pnpm build` exits 0
- [ ] `grep -c "5b8def" app/globals.css` → 0 and `grep -c "D71921" app/globals.css` → ≥4
- [ ] `grep -c "Space_Grotesk" app/layout.tsx` → 1; `grep -c "DM_Sans" app/layout.tsx` → 0
- [ ] `grep -c "ff-dotgrid" app/globals.css` → ≥1
- [ ] `grep -c "borderRadius" tailwind.config.ts` → ≥1 and `grep -c "boxShadow" tailwind.config.ts` → ≥1
- [ ] `app/fonts/doto-variable.woff2` exists, is tracked by git (`git status` shows it as added)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The Doto woff2 download fails (no network / gstatic blocked). Fallback the
  maintainer must approve first: `@import url('https://fonts.googleapis.com/css2?family=Doto:wght@500;700;900&display=swap')`
  at the top of `globals.css` with `--font-doto` → `'Doto'` — this reintroduces
  a runtime Google Fonts dependency, unacceptable for offline deploys without
  sign-off.
- `pnpm build` fails with a next/font error about subsets or weights for
  Space Grotesk / Space Mono (would mean this Next version's font metadata
  differs from what recon found).
- `pnpm test` failures other than the two class-assertion tests named above.
- The current `globals.css` no longer matches the "Current state" excerpt
  (drift — a parallel restyle already landed).

## Maintenance notes

- **Status-color mapping is a design decision made here**: the design language
  is "monochrome + red as the sole interrupt", so `--status-error` == accent
  red, and success/warning/info collapse to monochrome. Green/amber affordances
  disappear app-wide. If the maintainer wants semantic green back for approvals,
  only `globals.css` needs re-editing. Plans 035 (badge) and 039 (approval bar)
  restyle the main status surfaces properly on top of this.
- The `boxShadow` kill and `borderRadius` override change **every** component's
  look without touching them. Floating panels (dropdowns, popovers) that relied
  on shadow for separation now rely on their `border` — most already have one;
  plans 037–039 upgrade the important ones to `border-strong`.
- `--accent-muted` changed from an opaque blue (`#253556`) to translucent red;
  anything using `bg-accent-muted` as a "readable tinted background" should be
  reviewed in later plans (avatar fallback does — restyled in 035).
- Doto is loaded `preload: false`; if dot-matrix numerals visibly flash-swap on
  the review page timecode (plan 039), flip to `preload: true`.
- Future components should use `font-mono` + `uppercase tracking-[0.08em..0.18em]`
  for labels, `font-dot` for large numerals, and never add `shadow-*` classes.
