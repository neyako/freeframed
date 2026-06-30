# Plan 013: Share-viewer comment-panel UX — bottom toggle on mobile + only auto-open when comments exist

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md` — unless a reviewer dispatched
> you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- "apps/web/app/share/[token]/page.tsx"`
> If it changed since this plan was written, compare the "Current state" excerpts
> below against the live file before editing; on a mismatch, STOP.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`apps/web`)
- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (one page component; additive UI + a default-state change)
- **Depends on**: none (Plan 001 already made this page responsive; this refines the comment panel UX)
- **Category**: bug / UX (mobile)
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

Two reviewer-facing complaints on the **public share viewer** (`/share/{token}`):

1. **The comment-panel toggle is in the top-right corner** (the `Columns2` button in the top bar). On a
   phone that is an awkward reach and easy to miss — the toggle should be **above the comment panel or
   anchored at the bottom of the screen** (request #1, sub-item).
2. **The panel should not appear unless the asset has comments** (request #5). Today the panel
   auto-opens on desktop regardless; a reviewer opening a fresh cut with no notes sees an empty
   "No comments yet" panel taking a third of the screen instead of the video.

This plan: on mobile, add a bottom-anchored **“Comments (N)”** button to open the panel and a collapse
handle to close it (the top-bar toggle stays for desktop); and change the default so the panel
**auto-opens only when comments exist**, otherwise it starts collapsed (the reviewer opens it when they
want to write the first comment via the bottom button).

## Current state — `apps/web/app/share/[token]/page.tsx`

### Default open state (lines ~707–715) — change this for #5

```tsx
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  // Open the comment panel by default on desktop; keep it collapsed on mobile so
  // the video is fully visible on first paint. Reviewers toggle it from the top bar.
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setSidebarOpen(true)
    }
  }, [])
```

`API_URL` is defined in this file (used elsewhere, e.g. line ~725 `fetch(\`${API_URL}/share/${token}/stream/...\`)`).

### The top-bar toggle (lines ~442–453) — keep for desktop, hide on mobile

```tsx
        <button
          onClick={onToggleSidebar}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
            sidebarOpen ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/10',
          )}
          title="Toggle panel"
        >
          <Columns2 className="h-4 w-4" />
        </button>
```

### The panel + viewer layout (lines ~754, ~764, ~565)

The main row is `flex flex-col md:flex-row` (Plan 001). The `ShareRightPanel` (the comments sidebar) is
rendered `{sidebarOpen && (<ShareRightPanel .../>)}` (line ~764) and its wrapper (line ~565) is
`w-full h-[55vh] border-t md:h-auto md:w-[360px] md:border-t-0 md:border-l …`. Comments load **inside**
the panel via `<GuestCommentList token={token} refreshKey={commentRefreshKey} />` (line ~606) — the
parent does not currently know the comment count, so #5 needs a small count fetch at the parent.

### Conventions

- Tailwind + `cn()`; **`md` (768px)** breakpoint; the page's existing zinc/white-alpha colors.
- `lucide-react` icons (already imported: `Columns2`, `MessageSquare`, `Loader2`, …). Reuse
  `MessageSquare` for the bottom button.
- The viewer root is `absolute inset-0 … overflow-hidden` (line ~738) — a `fixed`/absolutely-positioned
  bottom button must sit inside it with a high `z-` so it floats over the video.

## Commands you will need

| Purpose | Command (from repo root) | Expected |
|---------|--------------------------|----------|
| Install web deps | `cd apps/web && pnpm install --frozen-lockfile` | exit 0 |
| Build | `cd apps/web && pnpm build` | exit 0 |
| Anchor greps | see Done criteria | matches |

Quote the path in shell: `"apps/web/app/share/[token]/page.tsx"`.

## Scope

**In scope** (one file): `apps/web/app/share/[token]/page.tsx` —
- replace the desktop-`matchMedia` default with a comment-count gate (#5),
- hide the top-bar `Columns2` toggle on mobile and add a bottom-anchored “Comments (N)” open button +
  an in-panel collapse handle (#1b).

**Out of scope**: `GuestCommentList`/`GuestCommentInput`/`ShareRightPanel` internals beyond adding a
collapse handle row; the editor review page (that is Plan 011); any API change. The comment-count fetch
reuses the existing public `GET /share/{token}/comments` endpoint — do not add a new endpoint.

## Git workflow

- Branch: `advisor/013-share-viewer-comment-panel-ux`
- Conventional commit (e.g. `fix(web): share viewer comment panel — bottom toggle + open only when comments exist`).
- Do NOT push unless instructed.

## Steps

### Step 1: Gate the default-open on comment count (#5)

Replace the `matchMedia` effect (lines ~707–715) with a comment-count fetch that opens the panel once,
only when comments exist:

```tsx
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [commentCount, setCommentCount] = React.useState<number | null>(null)
  const autoOpened = React.useRef(false)

  // Fetch the comment count for this share so we can (a) label the mobile button and
  // (b) auto-open the panel ONCE only when there are comments (#5). Empty cuts start
  // with the panel collapsed so the video fills the screen.
  React.useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/share/${token}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return
        const n = Array.isArray(data) ? data.length : 0
        setCommentCount(n)
        if (n > 0 && !autoOpened.current) {
          setSidebarOpen(true)
          autoOpened.current = true
        }
      })
      .catch(() => { if (!cancelled) setCommentCount(0) })
    return () => { cancelled = true }
  }, [token, commentKey])
```

(`commentKey` already exists on this component, line ~706, and bumps when a comment is posted — keep it
in the deps so the count refreshes after the reviewer adds the first comment.)

**Verify**: `grep -n "auto-open the panel ONCE" "apps/web/app/share/[token]/page.tsx"` → match; and
`grep -n "matchMedia('(min-width: 768px)')" "apps/web/app/share/[token]/page.tsx"` → **no** match.

### Step 2: Hide the top-bar toggle on mobile (#1b)

The top-bar `Columns2` toggle is the desktop affordance; hide it below `md`. In the button at lines
~442–453, change the className's first token from `'flex items-center…'` to include `hidden md:flex`:

```tsx
          className={cn(
            'hidden md:flex items-center justify-center h-8 w-8 rounded-md transition-colors',
            sidebarOpen ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/10',
          )}
```

**Verify**: `grep -n "hidden md:flex items-center justify-center h-8 w-8" "apps/web/app/share/[token]/page.tsx"` → match.

### Step 3: Add a bottom-anchored “Comments (N)” button on mobile (#1b)

Inside the viewer root (the `absolute inset-0 …` container, line ~738), render a mobile-only floating
button that opens the panel when it is closed. Place it just before the closing `</div>` of that root
container (after the `Main content` block). It must be `md:hidden` and only show when `!sidebarOpen`:

```tsx
        {/* Mobile-only: open the comments panel from the bottom of the screen (#1b). */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-4 py-2.5 text-sm font-medium text-white shadow-lg border border-white/10"
          >
            <MessageSquare className="h-4 w-4" />
            Comments{commentCount ? ` (${commentCount})` : ''}
          </button>
        )}
```

**Verify**: `grep -n "Open the comments panel from the bottom" "apps/web/app/share/[token]/page.tsx"` → match.

### Step 4: Add an in-panel collapse handle (#1b — toggle "above the comment panel")

So the toggle is reachable from the panel itself (not just the far top corner), add a collapse row at
the very top of `ShareRightPanel`'s content. In `ShareRightPanel` (the component starting ~line 555),
its returned wrapper is the `w-full h-[55vh] … md:w-[360px]` div (line ~565). The panel renders a Tabs
header right after it (the `px-4 pt-3 pb-2` block, line ~567). Insert a mobile-only handle **above**
that tabs block:

```tsx
      {/* Mobile collapse handle — keeps the toggle adjacent to the panel (#1b). */}
      <button
        onClick={onClose}
        className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-zinc-400 border-b border-white/[0.06]"
      >
        <ChevronDown className="h-4 w-4" />
        Hide comments
      </button>
```

`ShareRightPanel` does not currently receive an `onClose` prop — add it. In `ShareRightPanelProps`
(near line ~555) add `onClose: () => void`, accept it in the destructured params, and pass it from the
render site (line ~764) as `onClose={() => setSidebarOpen(false)}`. Import `ChevronDown` from
`lucide-react` if not already imported (check the import block at the top first).

**Verify**:
- `grep -n "Hide comments" "apps/web/app/share/[token]/page.tsx"` → match
- `grep -n "onClose={() => setSidebarOpen(false)}" "apps/web/app/share/[token]/page.tsx"` → match

### Step 5: Build

**Verify**: `cd apps/web && pnpm install --frozen-lockfile && pnpm build` → exit 0. If it can't run, rely
on the grep anchors + manual check and say so.

## Test plan

- **Automated gate**: Step 1–4 grep anchors + clean `pnpm build`.
- **Manual (if you can run it; otherwise describe)** — open a reviewer share link on a phone-width
  viewport:
  1. **Asset with no comments**: panel starts **closed**; the video is full-screen; a bottom-center
     “Comments” button is visible. Tapping it opens the 55vh panel; the in-panel “Hide comments” handle
     closes it.
  2. **Asset with comments**: panel **auto-opens** once, and the bottom button reads “Comments (N)”.
  3. **Desktop (≥768px)**: the bottom button and collapse handle are hidden; the top-bar `Columns2`
     toggle works as before; the panel still auto-opens only when comments exist.

## Done criteria

ALL must hold (greps from repo root, path quoted):

- [ ] `grep -n "auto-open the panel ONCE" "apps/web/app/share/[token]/page.tsx"` → match
- [ ] `grep -n "matchMedia('(min-width: 768px)')" "apps/web/app/share/[token]/page.tsx"` → **no** match
- [ ] `grep -n "Open the comments panel from the bottom" "apps/web/app/share/[token]/page.tsx"` → match
- [ ] `grep -n "Hide comments" "apps/web/app/share/[token]/page.tsx"` → match
- [ ] `grep -n "hidden md:flex items-center justify-center h-8 w-8" "apps/web/app/share/[token]/page.tsx"` → match
- [ ] `cd apps/web && pnpm build` exits 0 (or manual check recorded)
- [ ] Only `apps/web/app/share/[token]/page.tsx` changed (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 013 updated

## STOP conditions

Stop and report if:

- The share viewer no longer uses `sidebarOpen` / `ShareRightPanel` / the `flex flex-col md:flex-row`
  layout from "Current state" (it was refactored since `d229011`).
- `GET /share/{token}/comments` no longer returns a JSON array (the count fetch would break) — report
  the shape you found; do not invent a new endpoint.
- Adding the `onClose` prop forces touching `GuestCommentList`/`GuestCommentInput` internals — it should
  not; if it does, report rather than refactor them.

## Maintenance notes

- The comment count is fetched separately from the list (`GuestCommentList` fetches its own). That's a
  small duplicate request, accepted for simplicity; if it matters later, lift the list fetch into the
  parent and pass both count and items down.
- Keep the default-open rule **consistent with Plan 011** (editor page): panel auto-opens once only when
  comments exist. If you change one page's rule, change both.
- The bottom button uses `absolute` within the viewer root (which is `absolute inset-0`). If the root
  ever stops being a positioned ancestor, switch the button to `fixed`.
