# Plan 047: Fix guest share video playback — resolve the stream JSON before feeding the player

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 364e798..HEAD -- apps/web/components/share/folder-share-viewer.tsx apps/web/components/review/video-player.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `364e798`, 2026-07-03

## Why this matters

Guests opening a video share link see **"Video playback error"** — the video
never plays, on any browser, any viewport. Guest review is the product's core
flow (reviewers never get accounts), so this is a total outage of the main
feature. Root cause: the guest review screen passes the **JSON API endpoint
URL** directly as the `<video>` source instead of fetching that endpoint and
using the `url` field from its response. This regressed when plan 032 routed
single-asset guest shares through the rich review screen; plan 020's
`ShareVideoPlayer` (which fetched the JSON correctly) was orphaned in the
process. Confirmed live on 2026-07-03: the rendered `<video>` element's src is
the `:8000/share/{token}/stream/{assetId}` endpoint, `readyState` stays 0,
`videoWidth` stays 0.

## Current state

Relevant files:

- `apps/web/components/share/folder-share-viewer.tsx` — guest share screens.
  `ShareReviewInner` (line ~773) is the single-asset guest review screen; the
  bug is at lines ~801–804 and ~877–890.
- `apps/web/components/review/video-player.tsx` — shared player. Accepts
  `initialStreamUrl` and resolves leading-`/` paths against the API origin
  (lines ~172–193). Gets a small additive change (optional `poster` prop).
- `apps/web/hooks/use-video-player.ts` — decides hls.js vs direct src via
  `src.includes('.m3u8')` (line 181). **Do not modify.**
- `apps/api/routers/share.py` — the endpoint
  `GET /share/{token}/stream/{asset_id}` (line 1457) returns **JSON**, not
  media. **Do not modify.**

The broken code, `folder-share-viewer.tsx:799-804`:

```tsx
  const canComment = permission === 'comment' || permission === 'approve'
  const versionReady = currentVersion?.processing_status === 'ready'
  const shareSessionParam = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''
  const videoStreamUrl = asset && currentVersion?.id
    ? `/share/${token}/stream/${asset.id}?_=1&version_id=${currentVersion.id}${shareSessionParam}`
    : null
```

…consumed at `folder-share-viewer.tsx:877-890`:

```tsx
          {asset.asset_type === 'video' && versionReady && VideoPlayer ? (
            <VideoPlayer
              assetId={asset.id}
              key={videoStreamUrl ?? asset.id}
              comments={comments}
              className="flex-1"
              initialStreamUrl={videoStreamUrl}
```

`VideoPlayer` treats `initialStreamUrl` as a **media URL** — it only prefixes
the API origin, it never fetches it (`video-player.tsx:172-180`):

```tsx
  useEffect(() => {
    setStreamUrl(null);
    if (initialStreamUrl) {
      const resolved = initialStreamUrl.startsWith("/")
        ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}${initialStreamUrl}`
        : initialStreamUrl;
      setStreamUrl(resolved);
      return;
    }
```

But the API endpoint returns JSON (`apps/api/routers/share.py:1500-1534`):
for videos, `url` is `/stream/hls/master.m3u8?token=<hls JWT>` — a relative
path to the API's HLS proxy — plus `thumbnail_url` (presigned) and metadata:

```py
        else:
            # Route through /stream/hls so S3 can stay private (#51)
            hls_token = create_hls_token(media_file.s3_key_processed)
            url = f"/stream/hls/master.m3u8?token={hls_token}"
    ...
    return {
        "url": url,
        "asset_type": asset.asset_type.value,
        "name": asset.name,
        "version_id": str(media_file.version_id) if media_file.version_id else None,
        "thumbnail_url": thumb_url,
        "duration_seconds": media_file.duration_seconds,
    }
```

**The correct pattern already exists in this codebase** — the audio player
fetches the JSON first (`apps/web/components/review/audio-player.tsx:83-94`):

```tsx
    if (shareToken) {
      let cancelled = false
      setIsLoading(true)
      setError(null)
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const sp = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : ''
      fetch(`${API_URL}/share/${shareToken}/stream/${asset.id}?version_id=${version.id}${sp}`)
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load audio')))
        .then(data => { if (!cancelled) setAudioUrl(data.url) })
        .catch(err => { if (!cancelled) { setError(err.message); setIsLoading(false) } })
      return () => { cancelled = true }
    }
```

(`image-viewer.tsx:190-200` does the same. Only the video path is broken.)

Repo conventions that apply: client components use `'use client'`;
`API_URL` fallback is `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'`;
tests are vitest in `__tests__/` folders colocated with the code
(see `apps/web/components/share/__tests__/share-video-player.test.tsx` and
`apps/web/lib/__tests__/version-match.test.ts` for structure).

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0 (pnpm ONLY — never npm) |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass (baseline: 136 passed at plan time; you will add more) |
| Lint      | `pnpm lint`              | no new errors (pre-existing warnings OK) |

## Scope

**In scope** (the only files you should modify/create):

- `apps/web/components/share/share-stream.ts` (create)
- `apps/web/components/share/__tests__/share-stream.test.ts` (create)
- `apps/web/components/share/folder-share-viewer.tsx` (edit `ShareReviewInner` only)
- `apps/web/components/review/video-player.tsx` (additive `poster` prop only)

**Out of scope** (do NOT touch, even though they look related):

- `apps/web/hooks/use-video-player.ts` — the `.m3u8` detection is correct once
  it receives a real media URL.
- `apps/web/components/review/review-provider.tsx` — it also fetches this JSON
  (share mode) and stores `stream_url` on the pseudo-asset; deduplicating the
  two fetches is a follow-up, not this plan.
- `apps/web/components/review/audio-player.tsx`, `image-viewer.tsx` — already
  correct.
- `apps/web/components/share/share-video-player.tsx` + its test — orphaned
  component from plan 020; do NOT delete it (CI tripwires and plan-039 sweep
  territory) and do NOT wire it back in.
- `apps/api/**` — the endpoint contract is fine as-is.

## Git workflow

- Branch: `advisor/047-guest-share-video-stream-fix`
- Conventional commits with scope, e.g. `fix(share): fetch stream JSON before feeding guest video player`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Create the stream-info helper

Create `apps/web/components/share/share-stream.ts`:

```ts
export interface ShareStreamInfo {
  url: string
  asset_type?: string
  name?: string
  version_id?: string | null
  thumbnail_url?: string | null
  duration_seconds?: number | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

/**
 * Fetch stream info for an asset in a share link.
 * The endpoint returns JSON with a `url` field; for videos that url is a
 * relative HLS-proxy path (`/stream/hls/master.m3u8?token=…`) which callers
 * must resolve against the API origin before handing to a media element.
 */
export async function fetchShareStreamInfo(
  token: string,
  assetId: string,
  opts: { versionId?: string | null; shareSession?: string | null } = {},
): Promise<ShareStreamInfo> {
  const params = new URLSearchParams()
  if (opts.versionId) params.set('version_id', opts.versionId)
  if (opts.shareSession) params.set('share_session', opts.shareSession)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_URL}/share/${token}/stream/${assetId}${qs}`)
  if (!res.ok) throw new Error('Failed to load stream info')
  return res.json() as Promise<ShareStreamInfo>
}

/** Resolve a possibly-relative stream url against the API origin. */
export function resolveStreamUrl(url: string): string {
  return url.startsWith('/') ? `${API_URL}${url}` : url
}
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 2: Use it in `ShareReviewInner`

In `apps/web/components/share/folder-share-viewer.tsx`:

1. Add to the imports at the top of the file:
   `import { fetchShareStreamInfo, resolveStreamUrl } from './share-stream'`
2. In `ShareReviewInner`, **delete** the `videoStreamUrl` computation
   (the 4 lines quoted in Current state, ~801–804; keep `canComment`,
   `versionReady`, and `shareSessionParam` — `shareSessionParam` is still used
   elsewhere in the function... check: if it becomes unused, delete it too).
3. Add state + effect (place after the `versionReady` line):

```tsx
  const [streamInfo, setStreamInfo] = React.useState<{ url: string; poster: string | null } | null>(null)
  React.useEffect(() => {
    if (!asset || asset.asset_type !== 'video' || !versionReady) return
    let cancelled = false
    setStreamInfo(null)
    fetchShareStreamInfo(token, asset.id, {
      versionId: currentVersion?.id ?? null,
      shareSession,
    })
      .then((info) => {
        if (!cancelled) {
          setStreamInfo({ url: resolveStreamUrl(info.url), poster: info.thumbnail_url ?? null })
        }
      })
      .catch(() => { /* player shows its own error state on a null url */ })
    return () => { cancelled = true }
  }, [token, asset?.id, asset?.asset_type, currentVersion?.id, shareSession, versionReady])
```

4. Change the video branch of the JSX (the block quoted in Current state) to
   gate on `streamInfo` and pass the resolved URL + poster:

```tsx
          {asset.asset_type === 'video' && versionReady && VideoPlayer && streamInfo ? (
            <VideoPlayer
              assetId={asset.id}
              key={streamInfo.url}
              comments={comments}
              className="flex-1"
              initialStreamUrl={streamInfo.url}
              poster={streamInfo.poster}
              overlay={...unchanged...}
            />
          ) : ...
```

   The existing final `else` branch (centered `Loader2` spinner) already
   covers the "streamInfo still loading" case — no new fallback needed.

**Verify**: `pnpm exec tsc --noEmit` → exit 0 (will fail until Step 3 adds the
`poster` prop — run it after Step 3 if you prefer, but do not skip it).

### Step 3: Add the `poster` prop to `VideoPlayer`

In `apps/web/components/review/video-player.tsx`:

1. Extend the props interface:

```tsx
interface VideoPlayerProps {
  assetId: string;
  comments?: Comment[];
  overlay?: React.ReactNode;
  className?: string;
  /** Pre-fetched stream URL (for share mode — skips authenticated API call) */
  initialStreamUrl?: string | null;
  /** Optional poster image shown before playback starts */
  poster?: string | null;
}
```

2. Destructure `poster` in the component signature and pass it to the video
   element (currently `video-player.tsx:310-318`):

```tsx
        <video
          ref={videoRef}
          ...existing props unchanged...
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
        />
```

Purely additive — the authed editor page doesn't pass it and is unaffected.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 4: Unit tests for the helper

Create `apps/web/components/share/__tests__/share-stream.test.ts` (vitest;
model the fetch-mocking after `apps/web/lib/__tests__/api.test.ts`). Cases:

1. `fetchShareStreamInfo` calls
   `{API_URL}/share/tok/stream/asset-1?version_id=v1&share_session=s1` when
   both opts given (assert via the mocked `fetch`'s first argument).
2. Omits `version_id` / `share_session` params when not given (no `?` at all
   when neither).
3. Rejects with `Error('Failed to load stream info')` on a non-ok response.
4. `resolveStreamUrl('/stream/hls/master.m3u8?token=x')` returns the
   API-origin-prefixed URL; `resolveStreamUrl('https://cdn/x.mp4')` returns it
   unchanged.

**Verify**: `pnpm test` → all pass, including the 4+ new tests.

### Step 5: Full gate + live check

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0 errors;
`pnpm test` → all pass; `pnpm lint` → no new errors.

Live check (only if the dev stack is running — `curl -s http://localhost:8000/health`
returns 200): open an existing single-asset share link in a browser, confirm
the video plays and the console shows no media error. If no stack is running,
note that in your report; the unit gate is the requirement.

## Test plan

Covered in Step 4. No changes to existing tests expected; if
`share-video-player.test.tsx` (orphan) fails, that is pre-existing — STOP and
report rather than editing it.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0; ≥4 new tests in `components/share/__tests__/share-stream.test.ts`
- [ ] `grep -n "stream/\${asset.id}?_=1" components/share/folder-share-viewer.tsx` → no matches (old endpoint-as-src gone)
- [ ] `grep -c "fetchShareStreamInfo" components/share/folder-share-viewer.tsx` → ≥1
- [ ] `grep -c "poster" components/review/video-player.tsx` → ≥2 (prop + usage)
- [ ] `git status --porcelain` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `videoStreamUrl` construction at `folder-share-viewer.tsx:801-804` no
  longer matches the excerpt (someone else fixed or moved it).
- `VideoPlayer` already has a `poster` prop or no longer resolves
  leading-`/` `initialStreamUrl` against the API origin.
- The API endpoint response shape differs from the excerpt (e.g. `url` is
  absolute, or the field is renamed).
- `pnpm test` has failures unrelated to your change on the base branch.

## Maintenance notes

- Plan 048 edits the same function (`ShareReviewInner`) for mobile layout —
  execute 047 before 048 to avoid conflicts.
- Follow-up (not this plan): `ReviewProvider` share mode fetches the same JSON
  once already (`review-provider.tsx:151-155`) and each guest stream fetch
  logs a `viewed_asset` share-activity row — a session now logs ~2 per view.
  Deduplicating via context would fix both; the audio/image players would also
  benefit.
- Follow-up: `components/share/share-video-player.tsx` is dead code (plan 020,
  orphaned by 032). Delete in a dedicated cleanup once 039's guest-viewer
  sweep has landed.
- Reviewer: scrutinize the effect dependency array in Step 2 — a missing
  `currentVersion?.id` would break guest version switching (plan 033 feature).
