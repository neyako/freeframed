# Plan 029: Editor review page — open comments by default on desktop and stop the mobile Comments button overlapping the player controls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

Two issues on the editor's asset review page (`/projects/[id]/assets/[assetId]`):

1. **Desktop**: the comments sidebar starts hidden and only auto-opens if the
   asset already has comments. Reviewers expect the comment panel visible by
   default on a wide screen (that is where the work happens). It should open by
   default on desktop.
2. **Mobile**: the floating round "Comments" pill is centered at the bottom of
   the screen (`absolute bottom-4 left-1/2`), directly on top of the video
   player's control bar (play / loop / speed / volume / quality / fullscreen), so
   it covers the controls. It must not overlap them.

Both are fixed by (a) defaulting the sidebar open on desktop and (b) replacing
the floating pill with the top-bar panel toggle that already exists for desktop,
made visible at all breakpoints.

## Current state

File: `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`

**Sidebar state + auto-open effect** (lines 59, 61, 131–140):

```tsx
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const deepLinkApplied = useRef(false)
  const autoOpenedRef = useRef(false)
  ...
  // Auto-open the comments panel once, only when the asset actually has comments (#5).
  // Empty assets start with the panel hidden so the media fills the screen; the user
  // can open it any time via the top-bar toggle, and their choice then sticks.
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (comments.length > 0) {
      setSidebarOpen(true)
      autoOpenedRef.current = true
    }
  }, [comments.length])
```

**Top-bar desktop-only panel toggle** (lines 401–412) — note `hidden md:flex`:

```tsx
          <button
            onClick={() => setSidebarOpen((p) => !p)}
            className={cn(
              'hidden md:flex items-center justify-center h-8 w-8 rounded-md transition-colors',
              sidebarOpen
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover',
            )}
            title="Toggle sidebar"
          >
            <Columns2 className="h-4 w-4" />
          </button>
```

**Floating mobile pill** (lines 526–534) — the element that overlaps the controls:

```tsx
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-full bg-bg-hover backdrop-blur px-4 py-2.5 text-sm font-medium text-text-primary shadow-lg border border-border"
        >
          <MessageSquare className="h-4 w-4" />
          Comments{comments.length ? ` (${comments.length})` : ''}
        </button>
      )}
```

The mobile sidebar itself (lines 425–433) already has its own in-panel "Hide
comments" close handle (`md:hidden ... ChevronDown`), so once open on mobile the
user can close it without the pill.

`MessageSquare` is imported (line 31) and, after removing the pill, will be
unused unless still referenced elsewhere — check before removing the import.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors   |
| Lint      | `cd apps/web && pnpm lint`           | exit 0              |
| Tests     | `cd apps/web && pnpm test`           | all pass            |

## Scope

**In scope** (the only file you should modify):
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`

**Out of scope** (do NOT touch):
- `apps/web/components/review/video-player.tsx` and its control bar — the fix is
  to move the toggle out of the controls' way, not to restyle the player.
- The mobile bottom-sheet sidebar markup (lines 425–433) — keep its in-panel
  "Hide comments" handle as-is.
- The share viewer page `apps/web/app/share/[token]/page.tsx` — it has a similar
  pill but is replaced by Plan 032; leave it.

## Git workflow

- Branch: `advisor/029-editor-review-sidebar-and-mobile-toggle`
- Conventional commits, e.g. `fix(web): default-open review comments on desktop; move mobile toggle out of player controls`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Default the comments sidebar open on desktop

Replace the auto-open effect (lines 131–140 in "Current state") with a version
that opens on desktop unconditionally and keeps the mobile behavior (open only
when comments exist, so the media stays full-bleed on phones):

```tsx
  // Open the comments panel by default on desktop; on mobile keep it hidden
  // unless the asset already has comments. Runs once; the user's later choice sticks.
  useEffect(() => {
    if (autoOpenedRef.current) return
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches
    if (isDesktop || comments.length > 0) {
      setSidebarOpen(true)
      autoOpenedRef.current = true
    }
  }, [comments.length])
```

Leave the `const [sidebarOpen, setSidebarOpen] = useState(false)` initializer as
`false` (SSR-safe); the effect flips it on mount for desktop.

**Verify**: `cd apps/web && grep -n "matchMedia('(min-width: 768px)')" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → one match.

### Step 2: Make the top-bar toggle visible on all breakpoints

In the top-bar toggle button (lines 401–412), change the leading class from
`hidden md:flex` to `flex` so the same toggle works on mobile:

```tsx
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
              sidebarOpen
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover',
            )}
```

**Verify**: `cd apps/web && grep -n "hidden md:flex" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → no matches (this was the only one on the toggle).

### Step 3: Remove the overlapping floating mobile pill

Delete the entire `{!sidebarOpen && ( <button className="md:hidden absolute bottom-4 ..."> … )}` block (lines 526–534 in "Current state").

Then, if `MessageSquare` is no longer referenced in the file
(`grep -n "MessageSquare" apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`
returns only the import line), remove it from the `lucide-react` import (line 31).

**Verify**:
- `cd apps/web && grep -n "absolute bottom-4 left-1/2" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → no matches.
- `cd apps/web && npx tsc --noEmit` → exit 0 (no "unused MessageSquare" error).

### Step 4: Full verification

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0
- `cd apps/web && pnpm lint` → exit 0
- `cd apps/web && pnpm test` → all pass

## Test plan

No new unit tests — the review page is an integration-heavy client component not
directly unit-tested for sidebar state. If an existing test asserts the pill or
the `hidden md:flex` toggle, update it to the new behavior and report it.
Verification is the grep anchors plus clean typecheck/lint/test.

## Done criteria

ALL must hold:

- [ ] `grep -n "matchMedia('(min-width: 768px)')" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → one match
- [ ] `grep -n "hidden md:flex" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → no matches
- [ ] `grep -n "absolute bottom-4 left-1/2" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → no matches
- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] Only the one in-scope file is modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live file (drift since `30e5364`).
- After removing the pill there is no other way to open the sidebar on mobile —
  i.e. Step 2 did not make the top-bar toggle visible on mobile. Both must be
  done together; do not ship Step 3 without Step 2.
- `MessageSquare` is used elsewhere in the file — leave the import; report it.

## Maintenance notes

- The single top-bar `Columns2` toggle now controls the sidebar at every
  breakpoint. If a designer wants a dedicated mobile affordance again, add it
  somewhere that does not sit over the player's bottom control bar (e.g. inside
  the top bar, or above the controls), never a bottom-centered floating element.
- Reviewer should confirm on a phone-width viewport that the player controls are
  fully tappable (nothing floating over them) and the top-bar toggle opens the
  bottom-sheet comments.
