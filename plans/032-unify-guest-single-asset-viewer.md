# Plan 032: Route single-asset guest shares through the rich review screen (custom player, timecoded/annotated comments, no crash)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- "apps/web/app/share/[token]/page.tsx" apps/web/components/share/folder-share-viewer.tsx`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

There are two completely different guest viewers in this codebase:

- **Folder / project shares** open an asset through a *rich* screen
  (`ShareReviewScreen` → `ReviewProvider` + the real `VideoPlayer`, `ImageViewer`,
  `AudioPlayer`, `CommentPanel`, `CommentInput`). This gives a custom player with
  quality/timestamp, timecoded comments, and annotations — the same as the editor.
- **Single-asset shares** (`/share/<token>` pointing at one asset) render a
  *stale, dumb* `ShareViewer` in `apps/web/app/share/[token]/page.tsx`: a plain
  `<video controls>` (browser-default player — no quality menu, no frame
  timestamp), a text-only guest comment box (no timecode, no annotation), and a
  comment list that **crashes the whole page**.

The crash (reported as "Application error: a client-side exception" and a
`TypeError: Cannot read properties of undefined (reading 'charAt')`) happens
because the single-asset comment list reads `comment.guest_name.charAt(0)`, but
the backend `/share/<token>/comments` endpoint returns the rich `CommentResponse`
shape (`author` / `guest_author` objects, **no** `guest_name` field). Any asset
that already has comments — e.g. one the editor commented on across multiple
versions — crashes on load.

Fix: make single-asset shares use the **same** `ShareReviewScreen` the folder
viewer already uses. This resolves all three reports at once — custom player with
quality + detailed timestamp, timecoded + annotated comments, and no crash
(`CommentPanel` derives the name safely as
`comment.author?.name ?? comment.guest_author?.name ?? "Unknown"`).

> Guest **version switching** (also requested) needs backend work and is handled
> separately in Plan 033; it depends on this plan.

## Current state

### `apps/web/components/share/folder-share-viewer.tsx` — the rich screen to reuse

`ShareReviewScreen` (defined ~line 716) is **not exported**. It renders the
`ReviewProvider` and dynamically imports the review components:

```tsx
/** Lazy-imported review components to avoid circular deps */
function ShareReviewScreen({
  token, shareSession, assetId, assetName, permission, allowDownload, onBack,
}: {
  token: string; shareSession?: string | null; assetId: string; assetName: string; permission: SharePermission; allowDownload: boolean; onBack: () => void
}) {
  ...
```

`ShareReviewInner` (~line 772) renders the top bar with a back button that calls
`onBack` unconditionally (~lines 846–848):

```tsx
          <button onClick={onBack} className="flex items-center justify-center h-7 w-7 rounded-md ...">
            <ArrowLeft className="h-4 w-4" />
          </button>
```

It is currently consumed only by `AssetViewer` (~line 697) inside this same file:

```tsx
function AssetViewer({ token, shareSession, asset, permission, allowDownload, onBack }: AssetViewerProps) {
  return (
    <div className="fixed inset-0 z-50">
      <ShareReviewScreen
        token={token}
        shareSession={shareSession}
        assetId={asset.id}
        assetName={asset.name}
        permission={permission}
        allowDownload={allowDownload}
        onBack={onBack}
      />
    </div>
  )
}
```

### `apps/web/app/share/[token]/page.tsx` — the dumb single-asset path to delete

- `stage: 'ready'` (single asset) renders `<ShareViewer …>` (page bottom, ~line 1123):
  ```tsx
  return (
    <ShareViewer
      token={token}
      asset={state.asset}
      permission={state.permission}
      allowDownload={state.allowDownload}
      branding={state.branding}
    />
  )
  ```
- `ShareViewer` (line 701) uses `ShareVideoPlayer` (browser-default `<video controls>`)
  and `ShareRightPanel` → `GuestCommentList`.
- **The crash** is in `GuestCommentList` (line 240):
  ```tsx
  {comment.guest_name.charAt(0).toUpperCase()}
  ```
  `comment.guest_name` is `undefined` for the real `CommentResponse` shape.
- Dead/dumb components defined in this file, all reachable only from `ShareViewer`
  (plus `FolderAssetViewer`, which is defined but **never rendered** anywhere):
  `ShareTopBar`, `ShareMediaViewer`, `ShareRightPanel`, `GuestCommentList`,
  `GuestApprovalActions`, `FieldRow`, `ShareViewer`, `FolderAssetViewer`.
- Imports used only by those: `ShareVideoPlayer` (from
  `@/components/share/share-video-player`) and `GuestCommentInput` (from
  `@/components/review/guest-comment-input`), plus several `lucide-react` icons.

The `stage: 'folder_ready'` branch (renders `<FolderShareViewer>`) and all the
gate states (`loading`, `password_required`, `expired`, `invalid`,
`auth_required`) are correct and must be preserved.

### Why `CommentPanel` is safe (no charAt crash)

`apps/web/components/review/comment-panel.tsx:393-394`:
```tsx
  const authorName =
    comment.author?.name ?? comment.guest_author?.name ?? "Unknown";
```
It never assumes `guest_name`. `getInitials(authorName)` always receives a
non-empty string. This is why the rich path does not crash on guest comments.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors   |
| Lint      | `cd apps/web && pnpm lint`           | exit 0              |
| Tests     | `cd apps/web && pnpm test`           | all pass            |
| Build     | `cd apps/web && pnpm build`          | exit 0 (route compiles) |

## Scope

**In scope**:
- `apps/web/components/share/folder-share-viewer.tsx` (export the screen; make the
  back button optional)
- `apps/web/app/share/[token]/page.tsx` (render the rich screen for single assets;
  delete the dead dumb path + now-unused imports)

**Out of scope** (do NOT touch):
- The `ReviewProvider`, `VideoPlayer`, `CommentPanel`, `CommentInput`, etc. — reuse
  as-is. The rich flow already works for folder shares.
- Backend `apps/api/**` — no API change here (version switching is Plan 033).
- Guest **version switching** — do not attempt it in this plan (Plan 033).
- `share-video-player.tsx` and `guest-comment-input.tsx` files — you will remove
  their *imports* from `page.tsx`, but do not delete the files (other code/tests
  may import them; deletion is a deferred cleanup).

## Git workflow

- Branch: `advisor/032-unify-guest-single-asset-viewer`
- Conventional commits, e.g. `fix(web): render single-asset guest shares with the rich review screen (fixes comment crash + player)`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Export `ShareReviewScreen` and make its back button optional

In `apps/web/components/share/folder-share-viewer.tsx`:

1. Add `export` to the `ShareReviewScreen` function declaration:
   `export function ShareReviewScreen({ … })`.
2. Widen its `onBack` prop and `ShareReviewInner`'s `onBack` to optional:
   change `onBack: () => void` to `onBack?: () => void` in both the
   `ShareReviewScreen` prop type and where `ShareReviewInner` is typed/used.
3. In `ShareReviewInner`'s top bar, render the back button only when `onBack` is
   provided:
   ```tsx
   {onBack && (
     <button onClick={onBack} className="flex items-center justify-center h-7 w-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0">
       <ArrowLeft className="h-4 w-4" />
     </button>
   )}
   ```
   Leave `AssetViewer` unchanged — it still passes `onBack`, so folder shares keep
   their back button.

**Verify**:
- `cd apps/web && grep -n "export function ShareReviewScreen" components/share/folder-share-viewer.tsx` → one match.
- `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Render the rich screen for single-asset shares

In `apps/web/app/share/[token]/page.tsx`:

1. Add an import at the top:
   `import { ShareReviewScreen } from '@/components/share/folder-share-viewer'`
2. Replace the final `return (<ShareViewer … />)` (the `stage: 'ready'` fall-through
   at the bottom of `SharePage`) with:
   ```tsx
   return (
     <ShareReviewScreen
       token={token}
       shareSession={shareSession}
       assetId={state.asset.id}
       assetName={state.asset.name}
       permission={state.permission}
       allowDownload={state.allowDownload}
     />
   )
   ```
   (No `onBack` — single-asset shares have nowhere to go back to; the button is now
   hidden by Step 1.)

**Verify**: `cd apps/web && grep -n "<ShareReviewScreen" "app/share/[token]/page.tsx"` → one match.

### Step 3: Delete the dead dumb single-asset components

In `apps/web/app/share/[token]/page.tsx`, remove these now-unreferenced
component definitions and their prop interfaces:
`ShareTopBar` (+ `ShareTopBarProps`), `ShareMediaViewer` (+ props),
`ShareRightPanel` (+ props), `GuestCommentList` (+ props), `GuestApprovalActions`
(+ props), `FieldRow`, `ShareViewer` (+ `ShareViewerProps`), and
`FolderAssetViewer` (+ `FolderAssetViewerProps`). Also remove the `GuestComment` /
`CommentsResponse` interfaces if they become unused after these deletions.

Keep everything else: `fetchShareInfo`, `PasswordGate`, `ErrorState`, the
`SharePage` component, the `PageState` union, and the `folder_ready` →
`<FolderShareViewer>` branch.

After deletion, remove now-unused imports (verify each with `grep` before removing):
- `import { ShareVideoPlayer } from '@/components/share/share-video-player'`
- `import { GuestCommentInput } from '@/components/review/guest-comment-input'`
- Unused `lucide-react` icons (e.g. `Download`, `ArrowLeft`, `Columns2`,
  `MessageSquare`, `User`, `FileText`, `Video`, `Music`, `CheckCircle2`,
  `XCircle`, `ChevronDown`, `Image as ImageIcon` — keep only those still used by
  the gate states / `SharePage`). Let `npx tsc --noEmit` and `pnpm lint` tell you
  exactly which are unused.

**Verify**:
- `cd apps/web && grep -n "guest_name.charAt" "app/share/[token]/page.tsx"` → no matches (the crash line is gone).
- `cd apps/web && grep -n "function ShareViewer\|function GuestCommentList\|function FolderAssetViewer" "app/share/[token]/page.tsx"` → no matches.
- `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 4: Full verification

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0
- `cd apps/web && pnpm lint` → exit 0
- `cd apps/web && pnpm test` → all pass
- `cd apps/web && pnpm build` → exit 0 (the `/share/[token]` route compiles with the dynamic-imported review components)

## Test plan

- Run the existing share tests: `cd apps/web && pnpm test share`. If any test
  imports or asserts the deleted `ShareViewer` / `GuestCommentList` from
  `page.tsx`, update or remove those assertions (the components no longer exist).
  Report which tests changed.
- Add a lightweight regression test if a share-page test harness exists:
  render the single-asset ready state and assert the page does **not** throw when
  the comments fetch returns a `CommentResponse`-shaped object with `author` set
  and `guest_name` absent (this is the exact crash condition). If mocking the
  dynamic imports is impractical in jsdom, skip the new test and rely on the
  `pnpm build` + manual smoke — note this in your report.
- Manual smoke (if a running stack is available): open a single-asset share link
  for an asset that already has at least one comment; the page loads the custom
  player and the comment panel without the "Application error" overlay.

## Done criteria

ALL must hold:

- [ ] `grep -n "export function ShareReviewScreen" apps/web/components/share/folder-share-viewer.tsx` → one match
- [ ] `grep -n "<ShareReviewScreen" "apps/web/app/share/[token]/page.tsx"` → one match
- [ ] `grep -rn "guest_name.charAt" apps/web/app/share/` → no matches
- [ ] `grep -n "function ShareViewer\b" "apps/web/app/share/[token]/page.tsx"` → no matches
- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] `cd apps/web && pnpm build` exits 0
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live files (drift since `30e5364`).
- Importing `ShareReviewScreen` from `folder-share-viewer.tsx` into the share page
  creates a circular-import build error — if so, extract `ShareReviewScreen`,
  `ShareReviewInner`, `GuestIdentityPrompt`, and the download helpers they use
  (`handleDownload`, `fetchDownloadUrl`, `triggerDownload`) into a new file
  `apps/web/components/share/share-review-screen.tsx`, re-import them into
  `folder-share-viewer.tsx`, and import from the new file in the page. Report that
  you took this path.
- `pnpm build` fails to compile the review components in guest mode for a reason
  other than a circular import — report the error.
- You discover the folder-share `AssetViewer` path is itself broken on the current
  code (i.e. the "rich" flow doesn't actually work) — do not build on top of it;
  report first.

## Maintenance notes

- **Deferred (known gap):** the old single-asset `ShareViewer` showed
  Approve/Reject buttons when `permission === 'approve'` (`GuestApprovalActions`).
  The rich `ShareReviewInner` does not render approval actions — and neither did
  the folder-share path before this change, so this is consistent, not a new
  divergence. If guest approve/reject on single-asset links is required, add it to
  `ShareReviewInner` in a follow-up (out of scope here). Flag this to the reviewer.
- Once this lands, `share-video-player.tsx` and `guest-comment-input.tsx` are
  likely dead; a later cleanup can delete them after confirming no other importers.
- Reviewer should confirm on a real single-asset share link: (1) the custom player
  (quality menu + timestamp) appears, (2) posting a comment attaches the current
  timecode and any annotation, (3) an asset that already has comments loads
  without the "Application error" overlay.
- Guest version switching is Plan 033 and depends on the exported
  `ShareReviewScreen` from this plan.
