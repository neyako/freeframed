# Plan 082: Batch the guest share listing and list_folders queries (kill the two remaining N+1s)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96b6644..HEAD -- apps/api/routers/share.py apps/api/routers/folders.py`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (do NOT run concurrently with plan 080 — it also edits
  `folders.py`; land 080 first or rebase)
- **Category**: perf
- **Planned at**: commit `96b6644`, 2026-07-12

## Why this matters

`GET /share/{token}/assets` — the **public, unauthenticated** guest-share
listing — issues up to ~11 queries per subfolder (2 counts + a preview query
+ up to 4 × 2-query `_get_latest_media_file` calls) and 4 per asset. With the
default `per_page=50`, one page load can be 200–400 queries. On the single-box
NAS deployment these round-trips compete with ffmpeg workers for the same
Postgres and CPU. Separately, `list_folders`' common branch (full project
member / public project) still does 2 COUNT queries per folder while the
scoped branch immediately above it is already batched. The codebase has four
proven batch exemplars (`comments.py:_fetch_comment_tree_data`,
`folders.py:_scoped_folder_responses`, `folders.py:get_folder_tree`,
`assets.py:_build_asset_responses_bulk`) — this plan applies the same pattern
to the two remaining hot loops.

## Current state

Files:

- `apps/api/routers/share.py` — `get_folder_share_assets` (starts ~line 1399).
  Two branches: the **multi-share** branch (~1432–1478, when the link carries
  explicit `multi_folder_ids`/`multi_asset_ids`) and the **normal
  folder/project** branch (~1521–1610). Both loop per row.
  `_get_latest_media_file` helper at ~264–273 (2 queries per call: latest
  ready `AssetVersion`, then its `MediaFile`).
- `apps/api/routers/folders.py` — `list_folders` (~280–323): scoped branch
  returns `_scoped_folder_responses(db, folders, project_id, access)`
  (batched, ~156–181); fallback branch returns
  `[_folder_to_response(db, f) for f in folders]` where `_folder_to_response`
  → `_compute_item_count` (~109–123) = 2 COUNTs per folder.

Per-subfolder loop today (`share.py:1522-1552`, normal branch — the
multi-share branch at 1437–1454 is the same shape):

```python
for sf in subfolders_query:
    asset_count = db.query(sa_func.count(Asset.id)).filter(
        Asset.folder_id == sf.id, Asset.deleted_at.is_(None),
    ).scalar() or 0
    child_folder_count = db.query(sa_func.count(Folder.id)).filter(
        Folder.parent_id == sf.id, Folder.deleted_at.is_(None),
    ).scalar() or 0
    thumb_urls: list[str] = []
    preview_assets = db.query(Asset).filter(
        Asset.folder_id == sf.id, Asset.deleted_at.is_(None),
    ).order_by(Asset.created_at.desc()).limit(4).all()
    for pa in preview_assets:
        mf = _get_latest_media_file(db, pa.id)
        ...
```

Per-asset loop today (`share.py:1574-1600`):

```python
for asset in assets:
    media_file = _get_latest_media_file(db, asset.id)          # 2 queries
    comment_count = db.query(sa_func.count(Comment.id)).filter(
        Comment.asset_id == asset.id, Comment.deleted_at.is_(None),
    ).scalar() or 0                                            # 1 query
    creator = db.query(User).filter(
        User.id == asset.created_by, User.deleted_at.is_(None)
    ).first() if asset.created_by else None                    # 1 query
```

The batch exemplar to imitate (`folders.py:156-181`, `_scoped_folder_responses`):

```python
subfolder_counts = dict(db.query(Folder.parent_id, func.count(Folder.id)).filter(
    Folder.parent_id.in_(folder_ids), ...,
).group_by(Folder.parent_id).all()) if folder_ids else {}
asset_counts = dict(db.query(Asset.folder_id, func.count(Asset.id)).filter(
    Asset.folder_id.in_(folder_ids), Asset.deleted_at.is_(None),
).group_by(Asset.folder_id).all()) if folder_ids else {}
```

`list_folders` fallback branch today (`folders.py:317-323`):

```python
    folders = query.order_by(Folder.created_at.desc()).all()
    return [_folder_to_response(db, f) for f in folders]
```

Conventions:

- Every query filters `deleted_at IS NULL` — the batched versions must keep
  every soft-delete filter the per-row versions had.
- "Latest media file" semantics: **latest `AssetVersion` by `version_number`
  desc with `processing_status == ready` and `deleted_at IS NULL`, then that
  version's first `MediaFile`**. The batched replacement must preserve exactly
  this (a window function / `DISTINCT ON (asset_id) ... ORDER BY asset_id,
  version_number DESC` both work on Postgres).
- Response shapes (`FolderShareSubfolder`, `FolderShareAssetItem`,
  `FolderResponse`) must not change at all.
- Integration tests with real Postgres: `apps/api/tests/integration/`, and
  there is a query-count test exemplar —
  `apps/api/tests/integration/test_comments_batching_db.py` (written for the
  comment-tree batching fix). Model the new tests on it.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax | `python3 -m py_compile apps/api/routers/share.py apps/api/routers/folders.py` | exit 0 |
| Integration tests | `TEST_DATABASE_URL=postgresql://... python -m pytest apps/api/tests/integration/ -v -k "share_listing or folder_listing"` | new tests pass |
| Full unit suite | `python -m pytest apps/api/tests/ -v` | all pass (CI is the gate if no local env) |

## Scope

**In scope**:

- `apps/api/routers/share.py` — only `get_folder_share_assets` and new
  private helpers next to it
- `apps/api/routers/folders.py` — only `list_folders`' fallback branch and a
  small shared count helper
- `apps/api/tests/integration/test_share_listing_batching_db.py` (create)
- `apps/api/tests/integration/test_folder_listing_batching_db.py` (create)
- `plans/README.md` (status row)

**Out of scope**:

- `_get_latest_media_file` itself — other callers (single-asset endpoints)
  are fine with 2 queries; leave the helper and its callers alone. Build a
  separate `_latest_media_files_bulk(db, asset_ids) -> dict[UUID, MediaFile]`.
- `validate_share_link_with_session` / any authz logic in the endpoint — do
  not restructure permission checks.
- Splitting `share.py` into modules — explicitly deferred (a later plan);
  keep all new helpers in `share.py`.
- Response schema files (`schemas/`) — shapes unchanged.

## Git workflow

- Branch: `advisor/082-listing-batch-queries`
- Conventional commits, e.g. `perf(share): batch guest folder-listing queries`.
- Do NOT push or merge.

## Steps

### Step 1: Bulk latest-media-file helper in share.py

Add next to `_get_latest_media_file` (~line 275):

```python
def _latest_media_files_bulk(db: Session, asset_ids: list[uuid.UUID]) -> dict[uuid.UUID, MediaFile]:
    """Latest ready version's media file per asset — bulk version of _get_latest_media_file."""
    if not asset_ids:
        return {}
    latest = (
        db.query(AssetVersion)
        .filter(
            AssetVersion.asset_id.in_(asset_ids),
            AssetVersion.deleted_at.is_(None),
            AssetVersion.processing_status == ProcessingStatus.ready,
        )
        .order_by(AssetVersion.asset_id, AssetVersion.version_number.desc())
        .all()
    )
    latest_by_asset: dict[uuid.UUID, AssetVersion] = {}
    for v in latest:
        latest_by_asset.setdefault(v.asset_id, v)
    version_ids = [v.id for v in latest_by_asset.values()]
    if not version_ids:
        return {}
    files = db.query(MediaFile).filter(MediaFile.version_id.in_(version_ids)).all()
    files_by_version = {}
    for f in files:
        files_by_version.setdefault(f.version_id, f)
    return {
        aid: files_by_version[v.id]
        for aid, v in latest_by_asset.items()
        if v.id in files_by_version
    }
```

(3 queries total regardless of asset count; "first MediaFile per version"
matches the single-row helper's `.first()`.)

**Verify**: `python3 -m py_compile apps/api/routers/share.py` → exit 0.

### Step 2: Batch the normal folder/project branch

In `get_folder_share_assets`' normal branch (~1521–1610):

1. Collect `sf_ids = [sf.id for sf in subfolders_query]` once. Replace the
   per-subfolder COUNTs with two `GROUP BY` dicts (copy the
   `_scoped_folder_responses` shape above).
2. Preview thumbnails: one query fetching, for all subfolders at once, the 4
   newest assets per folder — on Postgres use a window function:
   `ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY created_at DESC) <= 4`
   via a subquery; then one `_latest_media_files_bulk` call over all preview
   asset ids.
3. Asset loop: replace `_get_latest_media_file` with one
   `_latest_media_files_bulk([a.id for a in assets])`, the per-asset comment
   COUNT with one `GROUP BY Comment.asset_id` dict, and the per-asset creator
   lookup with one `User.id.in_(creator_ids)` dict.
4. Keep the item-assembly loops; they now only read from the dicts.

**Verify**: `python3 -m py_compile apps/api/routers/share.py` → exit 0;
`grep -c "_get_latest_media_file(db" apps/api/routers/share.py` decreased by
the number of call sites you removed (check remaining callers are outside
`get_folder_share_assets`).

### Step 3: Batch the multi-share branch

Apply the same four replacements to the multi-share branch (~1432–1478). It
assembles the same dict shapes — reuse the helpers/dicts from Step 2 where
the code allows (the branches are sequential, not nested; a small shared
inner function `_share_asset_items(db, assets) -> list[FolderShareAssetItem]`
is acceptable if both branches produce identical item shapes — note the
multi-share branch currently builds `FolderShareAssetItem` with slightly
different fields (`file_size_bytes`, isoformat `created_at`); preserve each
branch's exact current output).

**Verify**: `grep -n "_get_latest_media_file(db" apps/api/routers/share.py`
→ zero matches inside `get_folder_share_assets` (confirm by line numbers).

### Step 4: Batch list_folders' fallback branch

In `folders.py`, extract the two GROUP-BY count queries from
`_scoped_folder_responses` into a helper:

```python
def _batch_item_counts(db: Session, folder_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
```

returning `subfolder_count + asset_count` per folder id (unscoped variant:
no `Folder.id.in_(scoped_ids)` filter — plain `parent_id IN` +
`deleted_at IS NULL`). Have `_scoped_folder_responses` keep its scoped
version unchanged (its subfolder count is scope-filtered — do NOT unify the
scoped count into the unscoped helper). Then change the fallback:

```python
    folders = query.order_by(Folder.created_at.desc()).all()
    counts = _batch_item_counts(db, [f.id for f in folders])
    responses = []
    for f in folders:
        r = FolderResponse.model_validate(f)
        r.item_count = counts.get(f.id, 0)
        responses.append(r)
    return responses
```

Leave `_folder_to_response`/`_compute_item_count` in place — other call
sites (single-folder endpoints) still use them.

**Verify**: `python3 -m py_compile apps/api/routers/folders.py` → exit 0.

### Step 5: Query-count + parity integration tests

Create the two test files, modeled on
`apps/api/tests/integration/test_comments_batching_db.py` (it shows the
fixture style and how to count queries — SQLAlchemy `event.listens_for(engine,
"before_cursor_execute")`).

`test_share_listing_batching_db.py`:

1. **Parity**: build a project with a share link over a folder containing 3
   subfolders (with assets+thumbnails) and 5 assets (with ready versions,
   comments, creators). Call the endpoint; assert item counts, thumbnail
   presence, comment counts, and creator names match the fixture facts.
2. **Query ceiling**: same fixture; assert total queries for one
   `get_folder_share_assets` call ≤ 15 (was 50+ before this change).
3. **Multi-share parity**: a multi-share link (explicit asset+folder ids)
   returns the same items before/after semantics (assert against fixture
   facts, not against the old code).

`test_folder_listing_batching_db.py`:

1. **Parity**: project member lists folders (fallback branch — no restricted
   access); `item_count` per folder matches fixture.
2. **Query ceiling**: listing N=10 folders takes ≤ 6 queries.
3. **Scoped branch unchanged**: a scope-restricted user still gets
   scope-filtered counts (guards against accidentally unifying the two
   count semantics).

**Verify**: with `TEST_DATABASE_URL`:
`python -m pytest apps/api/tests/integration/ -v -k "share_listing or folder_listing"`
→ ≥6 tests pass. Without: they collect and skip.

## Test plan

Covered in Step 5. Also run the full existing suites — the endpoints are
heavily covered by `test_share_security_*_db.py`; they must stay green.

## Done criteria

- [ ] `python3 -m py_compile` exits 0 on both routers
- [ ] No `_get_latest_media_file(` call remains inside `get_folder_share_assets`
- [ ] New helper `_latest_media_files_bulk` exists in share.py
- [ ] `list_folders` fallback no longer calls `_folder_to_response` in a loop
- [ ] ≥6 new integration tests exist and pass (or skip cleanly without env)
- [ ] Full `python -m pytest apps/api/tests/` green in CI
- [ ] `git status` clean outside in-scope list; `plans/README.md` updated

## STOP conditions

Stop and report back (do not improvise) if:

- The two branches' `FolderShareAssetItem` construction differs from the
  excerpts (field names/types drifted) — parity risk, re-verify before batching.
- The window-function preview query can't reproduce the exact "4 newest per
  folder" ordering — fall back to one preview query per *page* of subfolders
  is NOT acceptable improvisation; report instead.
- Existing `test_share_security_*` integration tests fail after your change.
- You need to modify `validate_share_link_with_session` or any schema file.

## Maintenance notes

- A later plan will split `share.py` into `share_links` / `share_guest` /
  `share_approvals` modules — `_latest_media_files_bulk` will move to the
  guest module or a `services/share_service.py`; keep it self-contained (no
  new cross-file imports) to make that move trivial.
- Reviewer: scrutinize the parity of "latest ready version" semantics —
  the bulk helper must not regress to "latest version regardless of status".
- If pagination is later added to subfolders (currently unpaginated), the
  preview window query needs a matching LIMIT strategy.
