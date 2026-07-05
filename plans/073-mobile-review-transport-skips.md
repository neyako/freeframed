# Plan 073: Mobile Review transport — ±5s skip buttons, loop button fixes

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**:
> `grep -c 'aria-label="Loop"' apps/web/components/review/video-player.tsx`
> must be `1`. If 0, the transport bar changed since planning — compare against
> "Current state" before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 065 (spec transport bar) merged — its DOM is the base here
- **Category**: mobile / design-conformance + bug fix
- **Planned at**: written 2026-07-05 (HEAD `3884b09`)

## Why this matters

Three small defects in the review video player transport bar
(`apps/web/components/review/video-player.tsx`):

1. **Mobile spec gap**: `app-mobile.dc.html` screen 1c (Review) specifies ±5s
   skip buttons in the mobile transport. On a phone there is no keyboard
   (arrow keys / J / L are the only current 5s-skip affordance), so mobile users
   cannot skip at all. Deferred from the round-9 mobile batch; this adds them.
2. **065 regression**: the loop button previously carried `hidden sm:` (desktop
   only); plan 065's restyle dropped it, so loop now crowds the narrow mobile
   transport. Restore desktop-only visibility — mobile gets the skip buttons in
   that space instead.
3. **Loop is decorative**: `const [loop, setLoop] = useState(false)` (line 137)
   toggles button styling only — the `loop` value is never applied to the
   `<video>` element and `use-video-player.ts` has no loop logic (verified:
   `grep -n loop apps/web/hooks/use-video-player.ts` → 0 matches). Clicking Loop
   changes the icon color and nothing else. Wire it.

## Current state

`apps/web/components/review/video-player.tsx` (only file in scope).

Video element (lines ~324–333) — note: no `loop` attribute:

```tsx
<video
  ref={videoRef}
  className={cn(
    "absolute inset-0 w-full h-full object-contain",
    isDrawingMode ? "pointer-events-none" : "",
  )}
  poster={poster ?? undefined}
  playsInline
  preload="metadata"
/>
```

Transport bar left cluster (lines ~371–417): Play (34×34 bordered), Loop,
Speed, Volume — in that order:

```tsx
{/* Left: Play, Loop, Speed, Volume */}
<div className="flex items-center gap-1 sm:gap-2">
  <button
    onClick={togglePlay}
    className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-bg-tertiary text-text-primary hover:border-border-strong transition-colors"
    aria-label={isPlaying ? "Pause" : "Play"}
  >
    {isPlaying ? (
      <Pause className="h-4 w-4" />
    ) : (
      <Play className="h-4 w-4" />
    )}
  </button>

  <button
    onClick={() => setLoop((p) => !p)}
    className={cn(
      "flex h-7 w-7 items-center justify-center rounded transition-colors",
      loop
        ? "text-accent"
        : "text-text-tertiary hover:text-text-primary",
    )}
    aria-label="Loop"
  >
    <Repeat className="h-4 w-4" />
  </button>
  ...
```

Already destructured from `useVideoPlayer(streamUrl)` and in scope inside the
component: `seek`, `currentTime`, `videoRef`. Existing keyboard handler uses the
exact seek idiom to copy: `seek(currentTime - 5)` / `seek(currentTime + 5)`
(lines ~266–273).

Imports from `lucide-react` currently: `Maximize, Minimize, Pause, Play,
Volume2, VolumeX, ChevronUp, Check, Repeat`.

### Repo conventions

- Tailwind tokens only (`text-text-tertiary`, `hover:text-text-primary`,
  `text-accent`). Borderless tertiary icon buttons are `flex h-7 w-7
  items-center justify-center rounded ... transition-colors` — match the Loop
  button exactly.
- Mobile-first responsive: mobile-only = `sm:hidden`, desktop-only =
  `hidden sm:flex` (this is a flex button, so `sm:flex` not `sm:block`).
- Every icon button has an `aria-label`.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**: `apps/web/components/review/video-player.tsx` only.

**Out of scope**: `use-video-player.ts` (loop wiring goes on the `<video>`
element via the existing `videoRef`/JSX, NOT into the hook),
`audio-player.tsx`, `share-video-player.tsx`, `progress-bar.tsx`, the keyboard
shortcut handler (already has 5s skips — leave it), all styling of other
transport controls.

## Git workflow

- Branch: `advisor/073-mobile-review-transport-skips`
- Commit: `fix(web): mobile ±5s skip buttons + loop wiring in review player (plan 073)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Wire loop to the video element

Add the `loop` attribute to the `<video>` element:

```tsx
<video
  ref={videoRef}
  ...
  playsInline
  preload="metadata"
  loop={loop}
/>
```

**Verify**: `grep -c "loop={loop}" apps/web/components/review/video-player.tsx` → `1`

### Step 2: Loop button desktop-only

Change the Loop button's base className from
`"flex h-7 w-7 items-center justify-center rounded transition-colors"` to
`"hidden sm:flex h-7 w-7 items-center justify-center rounded transition-colors"`.
Keep the active/inactive color logic untouched.

**Verify**: `grep -c 'hidden sm:flex h-7 w-7' apps/web/components/review/video-player.tsx` → `1`

### Step 3: Mobile ±5s skip buttons

Add `RotateCcw` and `RotateCw` to the existing `lucide-react` import. Insert two
mobile-only buttons around the Play button: back-skip immediately BEFORE Play,
forward-skip immediately AFTER Play (before the Loop button):

```tsx
<button
  onClick={() => seek(currentTime - 5)}
  className="sm:hidden flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
  aria-label="Back 5 seconds"
>
  <RotateCcw className="h-4 w-4" />
</button>
```

(then the existing Play button, then:)

```tsx
<button
  onClick={() => seek(currentTime + 5)}
  className="sm:hidden flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
  aria-label="Forward 5 seconds"
>
  <RotateCw className="h-4 w-4" />
</button>
```

**Verify**:
`grep -c 'aria-label="Back 5 seconds"' apps/web/components/review/video-player.tsx` → `1`
and `grep -c 'aria-label="Forward 5 seconds"' apps/web/components/review/video-player.tsx` → `1`

### Step 4: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test required — the change is JSX class strings, one attribute, and two
buttons that call the already-tested `seek` with constants. The gate plus the
done-criteria greps cover it. If an existing test snapshots the transport bar
and fails, update the snapshot and say so in NOTES.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "loop={loop}"` → `1` (video element loops when toggled)
- [ ] `grep -c 'hidden sm:flex h-7 w-7'` → `1` (loop button desktop-only)
- [ ] `grep -c 'aria-label="Back 5 seconds"'` → `1` and `grep -c 'aria-label="Forward 5 seconds"'` → `1`
- [ ] Desktop (`sm`+) visual: unchanged except loop now actually loops; skip buttons hidden
- [ ] Only `components/review/video-player.tsx` modified (`git status`)

## STOP conditions

- Drift check fails (no `aria-label="Loop"`) — the 065 transport was reworked;
  STOP and report.
- `seek` / `currentTime` are no longer destructured from `useVideoPlayer` in
  this component — STOP and report (do not modify the hook).
- Adding `loop={loop}` breaks a test that asserts video attributes — report it;
  update the assertion only if it's clearly asserting the old (buggy) behavior.

## Maintenance notes

- Skip amount (5s) matches the ArrowLeft/ArrowRight keyboard shortcuts — if one
  changes, change both.
- `share-video-player.tsx` has its own transport; if guests need mobile skips
  too, that's a separate small follow-up mirroring this pattern.
- If loop-on-HLS misbehaves (hls.js edge cases at stream end), the fix belongs
  in `use-video-player.ts`, not here.
