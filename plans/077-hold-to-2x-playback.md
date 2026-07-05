# Plan 077: Review player — hold-to-2x playback; hide speed/mute on mobile

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Base**: `preview/round10-view` @ `c47e8c5` (contains 073 skips + 076 grid
> transport).
>
> **Drift check (run first, all must pass)**:
> - `grep -Fc 'grid grid-cols-[1fr_auto_1fr] items-center h-12' apps/web/components/review/video-player.tsx` → `1` (076 present)
> - `grep -Fc 'const handleContainerClick = useCallback' apps/web/components/review/video-player.tsx` → `1`

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW-MED (pointer-event interaction with click-to-play; mitigated by suppress-ref pattern below)
- **Depends on**: 076 merged (same transport region)
- **Category**: mobile / UX
- **Planned at**: written 2026-07-05 against `preview/round10-view` @ `c47e8c5`

## Why this matters

Maintainer QA: the mobile transport still shows the speed-cycle (`1x`) and mute
buttons, crowding the left wing. Requested behavior: remove both from the
mobile transport and replace speed control with the TikTok/YouTube gesture —
**press-and-hold the video area to play at 2x, release to restore**. Desktop
keeps the speed/mute buttons; the hold gesture works at all widths (YouTube
does this on desktop too).

## Current state

`apps/web/components/review/video-player.tsx` (only file in scope).

Speed + mute buttons in the transport left wing (after 076; lines ~398-417):

```tsx
<button
  onClick={handleSpeedCycle}
  className="font-mono text-xs text-text-secondary hover:text-text-primary"
  aria-label="Playback speed"
>
  {playbackRate}x
</button>

<button
  onClick={toggleMute}
  className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
  aria-label={isMuted ? "Unmute" : "Mute"}
>
```

Video container + click handler (lines ~290-294 and ~320-323):

```tsx
const handleContainerClick = useCallback(() => {
  if (!isDrawingMode) {
    togglePlay();
  }
}, [togglePlay, isDrawingMode]);
```

```tsx
<div
  className="flex-1 relative min-h-0 bg-black overflow-hidden cursor-pointer"
  onClick={handleContainerClick}
>
```

Available from `useVideoPlayer` destructuring (already in scope):
`playbackRate`, `setPlaybackRate`, `togglePlay`, `isPlaying`. React hooks
`useCallback`, `useEffect`, `useRef`, `useState` already imported. `cn`
imported. The loading spinner / error overlays inside the container use
`absolute inset-0` — the new badge must not block them (`pointer-events-none`).

### Repo conventions

- Mobile-only = `sm:hidden`, desktop-only = `hidden sm:flex` (or `hidden
  sm:block` for non-flex) — transport buttons use the `sm` breakpoint (loop
  button precedent from 073).
- Tailwind tokens only; every icon button keeps its `aria-label`.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**: `apps/web/components/review/video-player.tsx` only.

**Out of scope**: `use-video-player.ts` (rate logic stays in the hook; the
gesture merely calls `setPlaybackRate`), `audio-player.tsx`,
`share-video-player.tsx`, keyboard shortcuts, desktop button rendering,
`handleSpeedCycle` logic (keep it — desktop still uses it).

## Git workflow

- Branch: `advisor/077-hold-to-2x-playback`
- Commit: `feat(web): hold-to-2x playback gesture; hide speed/mute on mobile (plan 077)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Hide speed + mute below `sm`

- Speed button: `className="font-mono text-xs text-text-secondary hover:text-text-primary"`
  → `className="hidden sm:block font-mono text-xs text-text-secondary hover:text-text-primary"`
- Mute button: `className="flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"`
  → `className="hidden sm:flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"`

CAUTION: the loop button and the fullscreen button have similar class strings —
edit exactly the two buttons whose `aria-label`s are "Playback speed" and
Unmute/Mute.

**Verify**: `grep -Fc 'hidden sm:block font-mono text-xs' apps/web/components/review/video-player.tsx` → `1`
and `grep -c 'hidden sm:flex h-7 w-7' apps/web/components/review/video-player.tsx` → `2`
(2 = loop button from 073 + the mute button)

### Step 2: Hold-to-2x gesture state + handlers

Inside the `VideoPlayer` component, after the `handleContainerClick` block, add:

```tsx
// Hold-to-fast: press-and-hold the video area plays at 2x (TikTok/YouTube style)
const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const holdPrevRateRef = useRef(1);
const holdSuppressClickRef = useRef(false);
const [isHoldingFast, setIsHoldingFast] = useState(false);

const startHold = useCallback(() => {
  if (isDrawingMode) return;
  holdTimerRef.current = setTimeout(() => {
    holdPrevRateRef.current = playbackRate;
    setPlaybackRate(2);
    setIsHoldingFast(true);
    holdSuppressClickRef.current = true;
  }, 500);
}, [isDrawingMode, playbackRate, setPlaybackRate]);

const endHold = useCallback(() => {
  if (holdTimerRef.current) {
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }
  if (isHoldingFast) {
    setPlaybackRate(holdPrevRateRef.current);
    setIsHoldingFast(false);
  }
}, [isHoldingFast, setPlaybackRate]);

useEffect(() => () => {
  if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
}, []);
```

And change `handleContainerClick` to swallow the click that ends a hold
(browsers fire `click` after `pointerup`, which would toggle play/pause):

```tsx
const handleContainerClick = useCallback(() => {
  if (holdSuppressClickRef.current) {
    holdSuppressClickRef.current = false;
    return;
  }
  if (!isDrawingMode) {
    togglePlay();
  }
}, [togglePlay, isDrawingMode]);
```

**Verify**: `grep -Fc 'holdSuppressClickRef.current' apps/web/components/review/video-player.tsx` → `3`

### Step 3: Wire the container + 2x badge

Video container div — add the pointer handlers and `select-none`:

```tsx
<div
  className="flex-1 relative min-h-0 bg-black overflow-hidden cursor-pointer select-none"
  onClick={handleContainerClick}
  onPointerDown={startHold}
  onPointerUp={endHold}
  onPointerLeave={endHold}
  onPointerCancel={endHold}
>
```

Inside the container (next to the loading-spinner overlay), add the indicator:

```tsx
{/* Hold-to-fast indicator */}
{isHoldingFast && (
  <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded bg-black/70 px-2.5 py-1 font-mono text-xs text-white">
    2x ››
  </div>
)}
```

**Verify**: `grep -Fc 'onPointerCancel={endHold}' apps/web/components/review/video-player.tsx` → `1`
and `grep -Fc '2x ››' apps/web/components/review/video-player.tsx` → `1`

### Step 4: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test file required (no existing tests cover VideoPlayer interactions;
jsdom pointer-event simulation of hold timing is poor value). Gate + greps
cover compile/regression. Manual QA: hold video ≥0.5s → badge + 2x audio;
release → prior speed, no play/pause toggle; quick tap still toggles play.

## Done criteria

- [ ] Gate green (tsc 0, tests pass, build 0)
- [ ] All step greps return expected counts
- [ ] Mobile (<`sm`) transport left wing: skip-back, play, skip-forward only
- [ ] Desktop (`sm`+): speed + mute + loop unchanged
- [ ] Hold ≥0.5s on video → 2x + badge; release → restores prior rate; the
      release does NOT toggle play/pause; a quick tap still toggles play/pause
- [ ] Only `components/review/video-player.tsx` modified

## STOP conditions

- Drift greps fail → wrong base; STOP.
- `handleContainerClick` was restructured (no `useCallback` form) → adapt
  minimally; STOP if click-to-play was removed entirely.
- `setPlaybackRate` no longer destructured from `useVideoPlayer` → STOP.

## Maintenance notes

- 500ms hold threshold and the fixed 2x rate are constants in `startHold` —
  tune there.
- If iOS long-press shows a system callout over the video, add
  `[-webkit-touch-callout:none]` to the container className (not added now —
  unverified need).
- The suppress-click ref assumes the browser fires `click` after `pointerup`
  on the same element; if a future overlay intercepts pointerup, the next tap
  would be swallowed once — reset logic lives in `handleContainerClick`.
- Guest player (`share-video-player.tsx`) doesn't get the gesture; mirror this
  plan there if guests want it.
