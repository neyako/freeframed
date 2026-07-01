# Plan 033: Let guests switch versions on share links (backend versions endpoint + version-aware stream + version switcher in the guest screen)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- apps/api/routers/share.py apps/web/components/review/review-provider.tsx apps/web/components/share/folder-share-viewer.tsx apps/web/components/review/video-player.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/032-unify-guest-single-asset-viewer.md` (needs the exported `ShareReviewScreen`/`ShareReviewInner`)
- **Category**: bug / feature
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

Guests reviewing a shared asset can only ever see the **latest** ready version.
The editor experience has a version switcher; guests asked for the same ("no
change version"). The blocker is entirely on the share path: in share mode the
front-end never fetches the version list, and the share stream endpoint always
serves the latest version. This plan adds a share-scoped versions endpoint, makes
the share stream endpoint version-aware, and renders the existing
`VersionSwitcher` in the guest screen — gated on the link's `show_versions` flag.

## Current state

### Backend — `apps/api/routers/share.py`

- `GET /share/{token}/stream/{asset_id}` (line 1427, `get_share_stream_url`)
  serves `_get_latest_media_file(db, asset.id)` and has **no** `version_id`
  parameter. It returns `{ url, asset_type, name, version_id, thumbnail_url,
  duration_seconds }`.
- `_get_latest_media_file` (line 159) returns the first media file of the latest
  **ready** `AssetVersion`.
- The `ShareLink` model has a `show_versions` boolean; reviewer shares set it
  `False` (`create_reviewer_share`, line 203), normal asset shares default it from
  the create body (default `True`). Respect it: if `show_versions` is `False`, do
  not expose other versions.
- Helpers already present in the file: `validate_share_link_with_session`,
  `_get_asset`, `_validate_asset_in_share`, `create_hls_token`,
  `generate_presigned_get_url`, `build_download_filename`. Model classes
  `AssetVersion`, `MediaFile`, `ProcessingStatus`/`processing_status` are imported
  or importable (see `_get_media_file_from_version` / `list_share_comments` for
  import style).

### Frontend — `apps/web/components/review/review-provider.tsx`

In share mode, `fetchAsset` (lines 89–162) builds a pseudo asset from **one**
stream call and leaves `versions` empty:

```tsx
      if (!shareToken) {
        // Fetch all versions for the version switcher (not available in share mode)
        const allVersions = await api.get<AssetVersion[]>(`/assets/${assetId}/versions`);
        ...
      } else if (data.latest_version) {
        setCurrentVersion(data.latest_version);
      }
```

`refetchVersions` (line 199) early-returns when `shareToken` is set.

### Frontend — `apps/web/components/review/video-player.tsx`

The stream effect (lines 172–193) uses `initialStreamUrl` if provided, else
fetches `/assets/${assetId}/stream`. Its dependency array is `[assetId,
initialStreamUrl]` — it does **not** re-fetch when `currentVersion` changes.

**You must first determine how the editor switches the displayed media when
`currentVersion` changes** (Step 0), because the guest path has to mirror it. The
`VersionSwitcher` component (`apps/web/components/review/version-switcher.tsx`)
only calls `useReviewStore().setCurrentVersion(v)`; something downstream must turn
a `currentVersion` change into a new stream URL.

## Commands you will need

| Purpose        | Command                                                     | Expected on success |
|----------------|------------------------------------------------------------|---------------------|
| API tests      | `cd apps/api && python -m pytest tests/ -q`                | all pass            |
| API single     | `cd apps/api && python -m pytest tests/test_reviewer_share.py -q` | pass         |
| Web typecheck  | `cd apps/web && npx tsc --noEmit`                          | exit 0              |
| Web lint       | `cd apps/web && pnpm lint`                                 | exit 0              |
| Web tests      | `cd apps/web && pnpm test`                                 | all pass            |

(Confirm the API test runner during Step 0: `ls apps/api/tests/` and check
`apps/api` for a `pytest.ini`/`pyproject.toml`. If pytest isn't configured, run
the existing share test the same way the repo's CI does — see
`.github/workflows/ci.yml`.)

## Scope

**In scope**:
- `apps/api/routers/share.py` (new versions endpoint + `version_id` on stream)
- `apps/api/tests/test_reviewer_share.py` (or a new `test_share_versions.py`)
- `apps/web/components/review/review-provider.tsx` (fetch versions in share mode; version-aware stream)
- `apps/web/components/share/folder-share-viewer.tsx` (render `VersionSwitcher` in `ShareReviewInner`)
- Possibly `apps/web/components/review/video-player.tsx` (only if Step 0 shows the player must re-fetch per version — mirror the editor)

**Out of scope**:
- The editor asset page — its version switcher already works; don't change it.
- `share-permission-select.tsx`, the share popup — unrelated.
- Do not expose versions when `link.show_versions` is `False`.

## Git workflow

- Branch: `advisor/033-guest-version-switching`
- Conventional commits, e.g. `feat(share): allow guests to switch asset versions`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 0: Trace how the editor turns a `currentVersion` change into a new stream

Read `apps/web/components/review/video-player.tsx` fully and
`apps/web/hooks/use-video-player.ts` (or wherever `useVideoPlayer` lives). Answer:
when the editor user picks a different version in `VersionSwitcher`
(`setCurrentVersion`), what causes the `<video>` to load that version's file?
- If the editor re-fetches `/assets/{id}/stream?version_id=…` keyed on
  `currentVersion`, the share path must do the equivalent against
  `/share/{token}/stream/{asset_id}?version_id=…`.
- Record your finding in the PR/report; it dictates Step 3's exact wiring.

**Verify**: you can state, in one sentence, the mechanism the editor uses. If you
cannot, STOP and report — do not guess-wire the player.

### Step 1: Add a share-scoped versions endpoint (backend)

In `apps/api/routers/share.py`, add:

```python
@router.get("/share/{token}/versions/{asset_id}")
def list_share_versions(
    token: str,
    asset_id: uuid.UUID,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public — ready versions for an asset on a share link, newest first.
    Returns only the latest version when the link has show_versions disabled."""
    link = validate_share_link_with_session(db, token, share_session=share_session, current_user=current_user)
    asset = _get_asset(db, asset_id)
    _validate_asset_in_share(db, link, asset)

    from ..models.asset import AssetVersion, ProcessingStatus
    q = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
        AssetVersion.processing_status == ProcessingStatus.ready,
    ).order_by(AssetVersion.version_number.desc())
    versions = q.all()
    if not link.show_versions:
        versions = versions[:1]
    return [
        {
            "id": str(v.id),
            "asset_id": str(asset.id),
            "version_number": v.version_number,
            "processing_status": v.processing_status.value if hasattr(v.processing_status, "value") else str(v.processing_status),
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in versions
    ]
```

Match the import style already used in `guest_comment` /
`_get_media_file_from_version` for `AssetVersion` / `ProcessingStatus`.

**Verify**: `cd apps/api && python -c "import routers.share"` → no import error (run from a shell where the app imports; otherwise rely on the test in Step 4).

### Step 2: Make the share stream endpoint version-aware (backend)

In `get_share_stream_url` (line 1427), add an optional query param and, when
present and permitted, serve that version instead of the latest:

```python
    version_id: Optional[uuid.UUID] = Query(None),
```

After `_validate_asset_in_share(...)`, before `media_file = _get_latest_media_file(...)`:

```python
    media_file = None
    if version_id and link.show_versions:
        from ..models.asset import AssetVersion
        version = db.query(AssetVersion).filter(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset.id,
            AssetVersion.deleted_at.is_(None),
        ).first()
        if version:
            media_file = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()
    if not media_file:
        media_file = _get_latest_media_file(db, asset.id)
    if not media_file:
        raise HTTPException(status_code=404, detail="No ready media file found")
```

(Replace the existing `media_file = _get_latest_media_file(...)` line; keep the
rest — the HLS/presign branch — unchanged. Falling back to latest keeps old
callers working.)

**Verify**: covered by the Step 4 test.

### Step 3: Fetch versions in share mode and make the guest player version-aware (frontend)

In `apps/web/components/review/review-provider.tsx`:
- In `fetchAsset`'s `shareToken` branch, after building the pseudo asset, fetch
  `${API_URL}/share/${shareToken}/versions/${assetId}${shareSessionParam}` and
  `setVersions(list)`. Pick the newest as `setCurrentVersion` if none set.
- Change `refetchVersions` to also work in share mode (fetch the same endpoint).
- Implement the mechanism you found in Step 0 for share mode: when
  `currentVersion` changes, the media must load that version. The lowest-risk
  approach is to pass a **version-scoped stream URL** down. Concretely, compute
  the share stream URL as
  `\`${API_URL}/share/${shareToken}/stream/${assetId}?_=1&version_id=${currentVersion.id}${shareSessionParam}\``
  path and have `ShareReviewInner` pass it to the player via `initialStreamUrl`,
  keyed on `currentVersion?.id` so it refetches on switch. **If** Step 0 showed the
  player instead fetches internally, mirror that instead.

In `apps/web/components/share/folder-share-viewer.tsx` (`ShareReviewInner`,
exported by Plan 032), render the version switcher in the top bar when there is
more than one version:

```tsx
  const { asset, versions, ... } = useReview()
  ...
  {versions.length > 1 && <VersionSwitcher versions={versions} />}
```

Import `VersionSwitcher` from `@/components/review/version-switcher`.

**Verify**:
- `cd apps/web && grep -n "share/${shareToken}/versions" components/review/review-provider.tsx` → one match (template literal; adjust the grep to the literal you wrote).
- `cd apps/web && grep -n "VersionSwitcher" components/share/folder-share-viewer.tsx` → import + usage.
- `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 4: Backend test

Add a test (extend `apps/api/tests/test_reviewer_share.py` or create
`apps/api/tests/test_share_versions.py`, modelled on the existing reviewer-share
test's fixtures) covering:
- An asset with two ready versions + a share link with `show_versions=True`:
  `GET /share/{token}/versions/{asset_id}` returns both, newest first.
- The same with `show_versions=False`: returns exactly one (the latest).
- `GET /share/{token}/stream/{asset_id}?version_id=<older>` with
  `show_versions=True` serves the older version's file (assert the returned
  `version_id` matches the requested one); with `show_versions=False` it falls
  back to latest.

**Verify**: `cd apps/api && python -m pytest tests/test_share_versions.py -q` (or the
extended file) → all pass.

### Step 5: Full verification

**Verify**:
- `cd apps/api && python -m pytest tests/ -q` → all pass
- `cd apps/web && npx tsc --noEmit` → exit 0
- `cd apps/web && pnpm lint` → exit 0
- `cd apps/web && pnpm test` → all pass
- `cd apps/web && pnpm build` → exit 0

## Test plan

- Backend: the three cases in Step 4 (two-version list, `show_versions` gating,
  version-scoped stream + fallback). Model on `apps/api/tests/test_reviewer_share.py`.
- Frontend: no new unit test is required if the mechanism is a version-keyed
  `initialStreamUrl` (hard to assert in jsdom); rely on typecheck/build + manual
  smoke. If `use-comments`/provider hooks have existing tests, ensure they stay
  green.
- Manual smoke (if a stack is available): a share link (`show_versions` on) for an
  asset with 2+ versions shows the switcher; picking an older version loads that
  version's media and comments.

## Done criteria

ALL must hold:

- [ ] `GET /share/{token}/versions/{asset_id}` exists and respects `show_versions`
- [ ] `GET /share/{token}/stream/{asset_id}?version_id=…` serves the requested version (fallback to latest)
- [ ] `grep -n "VersionSwitcher" apps/web/components/share/folder-share-viewer.tsx` → import + usage
- [ ] `cd apps/api && python -m pytest tests/ -q` all pass (incl. new version tests)
- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] `cd apps/web && pnpm build` exits 0
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 032 has not landed (`ShareReviewScreen`/`ShareReviewInner` not exported from
  `folder-share-viewer.tsx`) — this plan depends on it.
- Step 0 cannot determine how the editor maps `currentVersion` → displayed media.
  Do not guess-wire the player.
- The share stream change would break the existing folder-share playback (the
  fallback-to-latest is there to prevent this — verify it).
- Switching versions changes the video but **not** the comments (comments are
  fetched per-asset, not per-version, in share mode) — that may be acceptable, but
  report it so the reviewer decides whether comments should also filter by version.

## Maintenance notes

- Reviewer should verify a `show_versions=False` reviewer link shows **no**
  switcher and cannot fetch other versions via the API (the gating is enforced
  server-side in both new/edited endpoints, not just hidden in the UI).
- If the editor's version→stream mechanism is later refactored, revisit Step 3 so
  the guest path keeps mirroring it.
- Comments are currently asset-scoped on the share path; per-version comment
  filtering for guests is a possible follow-up, deliberately not done here.
