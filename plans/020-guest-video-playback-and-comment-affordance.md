# Plan 020: Make guest share videos actually play, and signal commenting to guests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4d0c20f..HEAD -- apps/web/app/share/[token]/page.tsx apps/web/hooks/use-video-player.ts apps/web/components/review/video-player.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4d0c20f`, 2026-06-30

## Why this matters

A reviewer opening a guest share link sees a tiny black video box that never
plays (screenshot: `/share/<token>` with an empty native player). Guest review
is the **core product flow** — projmgmt mints a guest link on `Editing→Review`
and reviewers only ever see that one video. If the video can't play, the
product's headline feature is broken for every external reviewer.

Root cause (confirmed by reading the code, not guessed): for a processed video
the share stream endpoint returns a **relative HLS manifest** URL
(`/stream/hls/master.m3u8?token=…`, `apps/api/routers/share.py:1459-1460`). The
share page drops that straight into a plain `<video src={streamUrl}>`
(`apps/web/app/share/[token]/page.tsx:477`). Two independent failures stack:

1. **Relative URL** — `<video src="/stream/hls/…">` resolves against the share
   page origin (e.g. `localhost:8080`), not the API, so the request 404s.
2. **HLS in a bare `<video>`** — `.m3u8` is only natively playable in Safari.
   In Chrome/Brave/Firefox a plain `<video>` cannot play HLS at all; it needs
   `hls.js`.

The editor page does NOT have this bug because it renders `<VideoPlayer>`, which
prepends the API origin and drives playback through `hls.js`
(`apps/web/components/review/video-player.tsx:174-195`, `apps/web/hooks/use-video-player.ts:181-220`).
The fix is to make the guest viewer use the same `hls.js`-based playback.

Second, smaller ask from the same screenshot review: a guest with a
**commentable** link has no idea they can comment — the comments panel starts
collapsed. We auto-open it on desktop for commentable links so the affordance
is visible. (This is a deliberate, share-page-only divergence from plan 013 /
011, which keep the panel collapsed-until-comments-exist for *logged-in* users;
guests need the affordance, signed-in editors already know it exists.)

## Current state

Files:

- `apps/web/app/share/[token]/page.tsx` — the guest share page. Contains the
  buggy `<video>` and the auto-open logic.
- `apps/web/hooks/use-video-player.ts` — `useVideoPlayer(src)` hook: attaches
  `hls.js` for `.m3u8` sources, falls back to native `<video>.src` for mp4.
  Depends ONLY on the `useReviewStore` zustand store (a global store, **no React
  provider required**) — so it is safe to use on the guest page.
- `apps/web/components/review/video-player.tsx` — the editor's full player.
  **Do not reuse directly**: it calls `useReview()` (line 139) which throws
  without `<ReviewProvider>`. The guest page has no provider. Use it only as the
  reference for how to resolve the URL and call the hook.

The buggy media viewer (`apps/web/app/share/[token]/page.tsx:469-492`):

```tsx
function ShareMediaViewer({ asset, token, streamUrl, streamLoading }: ShareMediaViewerProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-black min-h-0 overflow-hidden">
      {asset.asset_type === 'video' && (
        <div className="w-full h-full flex items-center justify-center">
          {streamLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
          ) : streamUrl ? (
            <video
              src={streamUrl}
              controls
              className="max-h-full max-w-full"
              preload="metadata"
            >
              Your browser does not support video playback.
            </video>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Video className="h-10 w-10 text-zinc-700" />
              <p className="text-sm text-zinc-500">Video unavailable</p>
            </div>
          )}
        </div>
      )}
      {/* audio + image branches follow — leave them unchanged */}
```

The URL-resolution + hook-call pattern to copy (`video-player.tsx:174-195`):

```tsx
const resolved = initialStreamUrl.startsWith("/")
  ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}${initialStreamUrl}`
  : initialStreamUrl;
// ...
const player = useVideoPlayer(streamUrl);   // hls.js lives inside this hook
```

The hook's relevant contract (`use-video-player.ts:50, 181-220, 308-334`): it
takes `src: string | null`, returns `{ videoRef, isLoading, error, ... }`, and
internally does `const isHlsSource = src.includes('.m3u8')` → `hls.loadSource`
for HLS, else `video.src = src`. You attach the returned `videoRef` to a
`<video>` element you render.

The auto-open logic to change (`apps/web/app/share/[token]/page.tsx:716-746`):

```tsx
const [sidebarOpen, setSidebarOpen] = React.useState(false)
const [commentCount, setCommentCount] = React.useState<number | null>(null)
const autoOpened = React.useRef(false)

React.useEffect(() => {
  let cancelled = false
  fetch(`${API_URL}/share/${token}/comments`)
    .then((r) => (r.ok ? r.json() : []))
    .then((data) => {
      if (cancelled) return
      const n = Array.isArray(data) ? data.length : 0
      setCommentCount(n)
      if (n > 0 && !autoOpened.current) {     // ← change this trigger
        setSidebarOpen(true)
        autoOpened.current = true
      }
    })
    .catch((error: unknown) => { /* ... */ })
  return () => { cancelled = true }
}, [token, commentKey])
```

`ShareViewer`'s `permission` prop is `SharePermission` (`'view' | 'comment' |
'approve'`); the comment input is enabled for `'comment'` and `'approve'`
(`apps/web/app/share/[token]/page.tsx:628`).

Repo conventions to match:
- Components are `'use client'`, function components, `cn()` from `@/lib/utils`
  for class merging, Tailwind with the project's `zinc`/`white/[0.06]` palette
  used elsewhere in this file.
- The share page already imports `Loader2` and `Video` from `lucide-react` and
  uses them for loading/error states — reuse that exact look in the new player.

## Commands you will need

| Purpose   | Command                                   | Expected on success      |
|-----------|-------------------------------------------|--------------------------|
| Install   | `pnpm install`                            | exit 0                   |
| Typecheck | `cd apps/web && pnpm exec tsc --noEmit`   | exit 0, no errors, or a captured pre-existing failure in untouched files |
| Lint      | `cd apps/web && pnpm lint`                | exit 0                   |
| Tests     | `cd apps/web && pnpm test`                | all pass (vitest run)    |

(`apps/web` has no `typecheck` npm script; use `pnpm exec tsc --noEmit` so the
repo-local compiler is used. If this or the full test suite is already red in
untouched, out-of-scope files, capture the exact failures and do not fix them in
this share-player plan.)

## Scope

**In scope** (the only files you should modify or create):
- `apps/web/components/share/share-video-player.tsx` (create)
- `apps/web/app/share/[token]/page.tsx` (edit)

**Out of scope** (do NOT touch):
- `apps/web/hooks/use-video-player.ts` — reuse as-is; do not edit.
- `apps/web/components/review/video-player.tsx` — reference only; do not edit.
- Any `apps/api/**` file. The relative HLS URL is correct server-side (the
  editor relies on it); the fix is entirely client-side URL resolution +
  `hls.js`. Do NOT change the API to return absolute URLs.
- The audio and image branches of `ShareMediaViewer` — they use absolute
  presigned URLs and already work. Leave them byte-for-byte unchanged.

## Git workflow

- Branch: `advisor/020-guest-video-playback`
- Conventional commits (match `git log`, e.g. `fix(web): play HLS in guest share viewer`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the guest video player component

Create `apps/web/components/share/share-video-player.tsx`. It wraps
`useVideoPlayer`, resolves a relative URL to the API origin, renders a `<video>`
with **native `controls`** (guests don't need the editor's custom transport
bar), and shows loading/error states matching the rest of the share page.

Target shape:

```tsx
'use client'

import { Loader2, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVideoPlayer } from '@/hooks/use-video-player'

interface ShareVideoPlayerProps {
  /** Raw stream URL from the share stream endpoint; may be a relative HLS path. */
  src: string
  className?: string
}

function resolveStreamUrl(url: string): string {
  return url.startsWith('/')
    ? `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}${url}`
    : url
}

export function ShareVideoPlayer({ src, className }: ShareVideoPlayerProps) {
  const { videoRef, isLoading, error } = useVideoPlayer(resolveStreamUrl(src))

  return (
    <div className={cn('relative w-full h-full flex items-center justify-center bg-black', className)}>
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        className="max-h-full max-w-full"
      />
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
          <Video className="h-10 w-10 text-zinc-700" />
          <p className="text-sm text-zinc-500">Video unavailable</p>
        </div>
      )}
    </div>
  )
}
```

Notes:
- `useVideoPlayer` returns more fields; destructure only `videoRef`,
  `isLoading`, `error`. Do not wire the custom transport — native `controls`
  is intentional and sufficient for guests.
- Do NOT prepend the API origin for already-absolute URLs (presigned mp4 for
  non-transcoded videos arrive absolute) — `resolveStreamUrl` handles both.

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Use the new player in `ShareMediaViewer`

In `apps/web/app/share/[token]/page.tsx`:

1. Add the import near the other component imports at the top of the file:
   ```tsx
   import { ShareVideoPlayer } from '@/components/share/share-video-player'
   ```
2. Replace ONLY the `<video …>` element inside the `asset.asset_type === 'video'`
   branch of `ShareMediaViewer` (the block shown in "Current state") with:
   ```tsx
   <ShareVideoPlayer src={streamUrl} className="min-h-0" />
   ```
   Keep the surrounding `streamLoading ? <Loader2…/> : streamUrl ? (…) : (<Video unavailable/>)`
   conditional exactly as it is — `ShareVideoPlayer` only replaces the inner
   `<video>`. The `streamUrl ?` guard guarantees `src` is a non-null string.
3. The `Video` icon import at the top of `page.tsx` is still used by the
   `streamUrl`-falsy branch — do not remove it.

**Verify**:
- `cd apps/web && pnpm exec tsc --noEmit` → exit 0, or exits nonzero only on
  captured pre-existing failures in untouched, out-of-scope files.
- `grep -n "<video" apps/web/app/share/[token]/page.tsx` → returns **no**
  matches (the only raw `<video>` lived in the video branch; audio uses
  `<audio>`, which must remain).

### Step 3: Auto-open the comments panel for commentable guest links (desktop)

In `apps/web/app/share/[token]/page.tsx`, `ShareViewer` already receives
`permission`. Change the auto-open trigger so the panel opens once, on desktop,
when the link allows commenting — instead of only when comments already exist.

Replace the `if (n > 0 && !autoOpened.current) { … }` block (inside the effect
at lines ~734-737) with permission-based logic. Add a desktop check so the
bottom-sheet does not cover the video on phones (the always-visible mobile
"Comments (N)" button already signals commentability there):

```tsx
setCommentCount(n)
const canComment = permission === 'comment' || permission === 'approve'
const isDesktop =
  typeof window !== 'undefined' &&
  window.matchMedia('(min-width: 768px)').matches
if (!autoOpened.current && canComment && isDesktop) {
  setSidebarOpen(true)
  autoOpened.current = true
}
```

`permission` is in scope inside `ShareViewer` (it's a prop). Add `permission`
to nothing new — it's already available; the effect closure can read it. Leave
`commentCount` / the mobile button code unchanged.

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "matchMedia('(min-width: 768px)')" apps/web/app/share/[token]/page.tsx`
  → 1 match.

### Step 4: Lint + test

**Verify**:
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → all pass.

## Test plan

This repo's web tests are vitest + jsdom (`apps/web/vitest.config.ts`). jsdom
has no real media stack and `hls.js` won't run there, so do **not** write a
"video actually plays" unit test — it would be a fake. Instead:

- Add `apps/web/components/share/__tests__/share-video-player.test.tsx`,
  modelled structurally on an existing component test
  (`apps/web/components/__tests__/button.test.tsx`). Cover the pure,
  deterministic behavior:
  - renders a `<video>` element (query by tag) given a src.
  - the error overlay text "Video unavailable" is absent on initial render.
  - (Optional) export `resolveStreamUrl` and unit-test it: a leading-slash URL
    gets the API origin prefixed; an `http(s)://…` URL is returned unchanged.
- Manual verification is the real gate for playback (note it in the PR): rebuild
  the all-in-one image from this branch, open a commentable share link in
  Chrome/Brave, confirm the video plays and the comments panel is open on a
  desktop viewport.

Verification: `cd apps/web && pnpm test` → all pass, including the new test.
If the full suite is already red in untouched, out-of-scope files, the Plan 020
pass condition is: the new focused test passes, lint passes, static guards pass,
browser QA passes, and the unrelated full-suite failures are captured with exact
file/error evidence.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && pnpm exec tsc --noEmit` exits 0, or exits nonzero only on
      captured pre-existing failures in untouched, out-of-scope files
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0, or exits nonzero only on captured
      pre-existing failures in untouched, out-of-scope files; new
      `share-video-player.test.tsx` passes
- [ ] `apps/web/components/share/share-video-player.tsx` exists and uses
      `useVideoPlayer`
- [ ] `grep -n "<video" apps/web/app/share/[token]/page.tsx` returns no matches
- [ ] `grep -n "matchMedia('(min-width: 768px)')" apps/web/app/share/[token]/page.tsx` returns 1 match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (drift since this plan was written).
- `useVideoPlayer` no longer exists or its signature changed (it must take a
  `src` string and return `{ videoRef, isLoading, error }`).
- Importing `useVideoPlayer` on the guest page causes a runtime error about a
  missing provider/context — that would mean the hook gained a `useReview()`
  dependency; STOP and report rather than wrapping the guest page in
  `ReviewProvider` (that path needs auth and is wrong for guests).
- You find the only way to make playback work requires editing `apps/api/**`.

## Maintenance notes

- The relative `/stream/hls/master.m3u8` URL is shared by both the editor and
  guest paths; both resolve it client-side. If the API is ever changed to
  return absolute stream URLs, `resolveStreamUrl` becomes a harmless no-op — do
  not also change the API and the client in the same pass.
- The auto-open divergence is intentional: guest commentable links open the
  panel on desktop; the editor (plan 011) and the share viewer for logged-in
  flows keep the "open only when comments exist" rule. A reviewer should confirm
  this divergence is desired, not accidentally unify them.
- Deferred out of scope: giving guests the editor's rich transport bar
  (frame-step, speed, quality). Native `controls` is the minimal correct fix;
  revisit only if guests ask for frame-accurate scrubbing on the share page.
