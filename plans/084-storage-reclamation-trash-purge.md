# Plan 084: Storage reclamation — empty-trash endpoint + scheduled purge that actually frees disk

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 89cf1b8..HEAD -- apps/api/routers/folders.py apps/api/services/s3_service.py apps/api/tasks/ apps/api/config.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — this plan introduces the codebase's FIRST permanent-delete
  path; a bug here destroys user media. The design below is deliberately
  conservative (age threshold + explicit endpoint + dry-run task mode).
- **Depends on**: plan 082 — landed (`8283482`), no longer blocking
- **Category**: direction / feature
- **Planned at**: commit `96b6644`, 2026-07-12
- **Revised**: 2026-07-13 after BLOCKED report — full FK graph mapped (was
  incomplete), third S3 prefix `watermarked/{asset_id}/` added, audit-history
  semantics decided by maintainer: **SET NULL + keep** for `activity_logs`,
  `share_link_activity` untouched, everything with a NOT NULL FK hard-deleted.
- **Revised again**: 2026-07-13 pm after a second (correct) executor STOP —
  three more FK edges found: `WatermarkSettings.share_link_id → share_links`
  (nullable), `ShareLinkActivity.share_link_id → share_links` (NOT NULL),
  `Notification.comment_id → comments` (nullable). Resolution: **ShareLink
  rows are soft-deleted + detached, never hard-deleted** (keeps activity FK
  valid and sidesteps watermark-settings FK), and **Notifications are deleted
  before Comments**. Details in Step 2.3.

## Why this matters

freeframed targets self-hosters on a NAS — disk is the scarce resource. Today
deletion is soft-delete only: `DELETE /assets/{id}` sets `deleted_at` and
**no code path ever removes the S3/MinIO objects** (verified: the only
`delete_object` callers are project posters and comment attachments). Every
deleted video keeps its original upload (`raw/...`) plus the full HLS ladder
(`processed/...`) forever. Trash restore exists (`/projects/{id}/trash`,
`/assets/{id}/restore`, `/folders/{id}/restore`) but there is no way — manual
or automatic — to reclaim the space. This plan adds: (a) a per-project
"empty trash" endpoint that permanently purges trashed items older than a
safety threshold (or all trashed items when explicitly requested), (b) a
weekly Celery beat task that purges trash older than a configurable retention
window, and (c) the S3 prefix-deletion helper both need.

## Current state

Files:

- `apps/api/routers/assets.py:207-218` — `delete_asset`: soft-delete only.
- `apps/api/routers/folders.py:592` — `list_trash` (per-project trashed
  folders + assets); `:644` `restore_asset`; `:671` `restore_folder`
  (uses `_lock_active_project`). (Line refs updated after plan 082 landed.)
- `apps/api/services/s3_service.py` — has `delete_object(s3_key)` (line
  ~262, single-key) and `get_s3_client()`; has NO list-prefix or bulk-delete
  helper.
- `apps/api/tasks/celery_app.py:58-63` — beat schedule with one entry
  (`due-date-reminders`, hourly crontab). Exemplar task:
  `apps/api/tasks/reminder_tasks.py` (SessionLocal try/finally pattern).
- `apps/api/config.py` — pydantic `Settings`; add new settings here
  (existing style: lowercase field, env var uppercase).
- S3 key layout (fixed, relied upon):
  - originals: `raw/{project_id}/{asset_id}/{version_id}/original{ext}`
    (`upload.py:130-131`)
  - processed HLS/thumbnails: `processed/{project_id}/{asset_id}/{version_id}/...`
    (`transcode_tasks.py:61`)
  - watermarked outputs: `watermarked/{asset_id}/output{ext}`
    (`watermark_tasks.py:114`) — NOTE: no project_id segment in this one.
  - So everything belonging to an asset lives under the THREE prefixes
    `raw/{project_id}/{asset_id}/`, `processed/{project_id}/{asset_id}/`,
    and `watermarked/{asset_id}/`.
- **Full FK graph around Asset** (verified 2026-07-13 via
  `grep -rn "assets.id\|asset_id" apps/api/models/`):
  - Direct FK to `assets.id`, NOT NULL: `AssetVersion` (asset.py:58),
    `Comment` (comment.py:20), `AssetMetadata` (metadata.py:35),
    `Approval` (approval.py:22), `Notification` (activity.py:52).
  - Direct FK to `assets.id`, nullable: `ShareLink` (share.py:25),
    `ShareLinkItem` (share.py:64), `AssetShare` (share.py:78),
    `ActivityLog` (activity.py:41).
  - Transitive: `CarouselItem` (asset.py:92-93, FKs `asset_versions.id` +
    `media_files.id`); `CommentReaction` + `Mention` (comment.py:53,
    activity.py:30, FK `comments.id`); comment annotations/attachments.
  - No FK at all: `ShareLinkActivity.asset_id` (share.py:110, plain UUID) —
    unaffected by hard deletes, leave untouched.
  - FKs INTO `share_links.id` (why links must survive as rows):
    `ShareLinkActivity.share_link_id` (share.py:106, NOT NULL),
    `WatermarkSettings.share_link_id` (branding.py:45, nullable),
    `ShareLinkItem.share_link_id` (share.py:63, NOT NULL).
  - `Notification.comment_id` (activity.py:53, nullable FK → comments) —
    notifications must be deleted BEFORE comments.
- MediaFile has `s3_key_raw`, `s3_key_processed`, `s3_key_thumbnail`;
  comment attachments have own `s3_key`, already hard-deleted via
  `comments.py:617`.

`delete_asset` today:

```python
@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(...):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    asset.deleted_at = datetime.now(timezone.utc)
    db.commit()
```

Beat exemplar (`celery_app.py:58-63`):

```python
celery_app.conf.beat_schedule = {
    "due-date-reminders": {
        "task": "send_due_date_reminders",
        "schedule": crontab(minute="0"),
    },
}
```

Conventions:

- Timezone-aware datetimes only (`datetime.now(timezone.utc)`).
- Soft-delete filters everywhere — purge queries are the ONE place that
  intentionally selects `deleted_at IS NOT NULL`; comment that explicitly.
- Permission style: `require_project_role(db, project_id, current_user,
  ProjectRole.owner)` — emptying trash is destructive, require **owner**
  (stricter than delete's `editor`).
- Integration tests in `apps/api/tests/integration/` (real Postgres); S3 is
  NOT available there — mock the s3_service functions at the module boundary
  (`unittest.mock.patch`), asserting the exact prefixes passed.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax | `python3 -m py_compile apps/api/routers/folders.py apps/api/services/s3_service.py apps/api/tasks/purge_tasks.py apps/api/tasks/celery_app.py apps/api/config.py` | exit 0 |
| Integration tests | `TEST_DATABASE_URL=... python -m pytest apps/api/tests/integration/ -v -k purge` | new tests pass |
| Full suite | `python -m pytest apps/api/tests/ -v` | green (CI is the gate if no local env) |

## Scope

**In scope**:

- `apps/api/services/s3_service.py` — add `delete_prefix(prefix: str) -> int`
- `apps/api/routers/folders.py` — add `POST /projects/{project_id}/trash/empty`
  (lives beside `list_trash`)
- `apps/api/tasks/purge_tasks.py` (create)
- `apps/api/tasks/celery_app.py` — beat entry + task import
- `apps/api/config.py` — `trash_retention_days: int = 30`
- `apps/api/.env.example` + root `.env.example` — document `TRASH_RETENTION_DAYS`
- `apps/api/tests/integration/test_trash_purge_db.py` (create)
- `plans/README.md` (status row)

**Out of scope**:

- Any web UI (an "Empty trash" button is a follow-up web plan; the endpoint
  ships first).
- `delete_asset` / restore endpoints — soft-delete semantics unchanged.
- Comment attachments (already hard-deleted at comment-delete time) and
  project posters (already handled).
- Multipart-upload garbage (incomplete uploads) — different mechanism
  (lifecycle rule / abort sweep), noted in Maintenance.

## Git workflow

- Branch: `advisor/084-trash-purge`
- Conventional commits, e.g. `feat(api): empty-trash endpoint + scheduled purge`.
- Do NOT push or merge.

## Steps

### Step 1: `delete_prefix` in s3_service

```python
def delete_prefix(prefix: str) -> int:
    """Permanently delete every object under prefix. Returns count deleted."""
    if not prefix or prefix.strip("/") in ("", "raw", "processed", "watermarked"):
        raise ValueError(f"refusing to delete overly broad prefix: {prefix!r}")
    s3 = get_s3_client()
    deleted = 0
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
        contents = page.get("Contents") or []
        if not contents:
            continue
        s3.delete_objects(
            Bucket=settings.s3_bucket,
            Delete={"Objects": [{"Key": o["Key"]} for o in contents]},
        )
        deleted += len(contents)
    return deleted
```

The guard clause is load-bearing: a bug that passes `""` or `"raw/"` must
raise, never wipe the bucket.

**Verify**: `python3 -m py_compile apps/api/services/s3_service.py` → exit 0.

### Step 2: Shared purge core

In `apps/api/tasks/purge_tasks.py`, write the core as a plain function so the
router and the beat task share one implementation:

```python
def purge_trashed_assets(db, *, project_id=None, older_than, dry_run=False) -> dict:
```

Behavior:

1. Select assets with `Asset.deleted_at.isnot(None)` and
   `Asset.deleted_at < older_than` (+ `Asset.project_id == project_id` when
   given). Also select trashed folders the same way; assets inside a trashed
   folder were cascade-trashed at the same time (see `delete_folder`) so the
   asset query already covers their media.
2. For each asset: call
   `delete_prefix(f"raw/{asset.project_id}/{asset.id}/")`,
   `delete_prefix(f"processed/{asset.project_id}/{asset.id}/")`, and
   `delete_prefix(f"watermarked/{asset.id}/")` (skip when `dry_run`).
3. Hard-delete DB rows in FK-safe order, ONLY for the selected ids:
   1. `Notification` first (`asset_id IN purged` OR `comment_id IN` comments
      of purged assets — its nullable `comment_id` FK blocks comment deletes
      otherwise), then `CommentReaction`, `Mention`, comment
      annotations/attachments → `Comment`
   2. `Approval`, `AssetMetadata` (NOT NULL FK — meaningless without the
      asset, hard-delete)
   3. `ShareLinkItem` rows for the asset → asset-scoped `AssetShare`
      (hard-delete both — grants/items, not audit). Asset-scoped
      `ShareLink` rows are **soft-deleted + retargeted, NOT hard-deleted**:
      `UPDATE share_links SET asset_id = NULL, project_id =
      <owning project id>, is_enabled = false, deleted_at =
      COALESCE(deleted_at, now())` for the purged asset ids. The
      `project_id` retarget is required by the check constraint
      `ck_share_link_asset_or_folder_or_project` (exactly ONE of asset_id /
      folder_id / project_id non-NULL — see migration `e8f9a0b1c2d3`); a
      fully detached link would violate it. Rationale for keeping the row:
      `ShareLinkActivity.share_link_id` is a NOT NULL FK and the maintainer
      keeps audit history; `WatermarkSettings.share_link_id` also points
      here. A multi-item ShareLink loses only this asset's item and
      survives untouched.
   4. `CarouselItem` (FKs versions + media) → `MediaFile` → `AssetVersion`
      → `Asset`
   5. Folder pass: folder-scoped `ShareLinkItem`/`AssetShare` hard-deleted;
      folder-scoped `ShareLink` soft-deleted + retargeted (`folder_id =
      NULL`, `project_id = <owning project id>`, same UPDATE shape as 3.3)
      → `Folder` for selected folders.
   6. **Audit history (maintainer decision 2026-07-13, keep it)**:
      `ActivityLog.asset_id` → `UPDATE ... SET asset_id = NULL` for purged
      ids (rows + JSONB payload survive); `ShareLinkActivity` rows are not
      touched (their link row survives per 3.3/3.5); `WatermarkSettings`
      rows are not touched.
4. Return `{"assets_purged": n, "folders_purged": m, "objects_deleted": k,
   "dry_run": dry_run}`.

Wrap it in a Celery task `purge_expired_trash` (name it exactly that) using
the `reminder_tasks.py` SessionLocal try/finally pattern, computing
`older_than = now - timedelta(days=settings.trash_retention_days)` across
all projects, and add `trash_retention_days: int = 30` to `config.py`. A
value of `0` disables the scheduled purge (task returns immediately) —
document that in `.env.example` (`TRASH_RETENTION_DAYS=30`, `# 0 disables
scheduled purge`; add to BOTH `.env.example` files).

**Verify**: `python3 -m py_compile apps/api/tasks/purge_tasks.py apps/api/config.py` → exit 0.

### Step 3: Beat entry

In `celery_app.py`, add to `beat_schedule`:

```python
"purge-expired-trash": {
    "task": "purge_expired_trash",
    "schedule": crontab(minute="30", hour="3", day_of_week="0"),  # weekly, Sun 03:30
},
```

and ensure the task module is imported wherever `reminder_tasks` is
(check `celery_app.py` / worker includes — `grep -rn "reminder_tasks"
apps/api/` and mirror it).

**Verify**: `python3 -m py_compile apps/api/tasks/celery_app.py` → exit 0;
`grep -n "purge_expired_trash" apps/api/tasks/celery_app.py` → 1+ match.

### Step 4: Empty-trash endpoint

In `folders.py`, beside `list_trash`:

```python
@router.post("/projects/{project_id}/trash/empty", response_model=dict)
def empty_trash(project_id: uuid.UUID, db=Depends(get_db), current_user=Depends(get_current_user)):
```

- `require_project_role(..., ProjectRole.owner)` and
  `_lock_active_project(db, project_id)`.
- Calls `purge_trashed_assets(db, project_id=project_id,
  older_than=datetime.now(timezone.utc))` — i.e. everything currently in
  trash, no age threshold: the user explicitly asked.
- Returns the counts dict.

**Verify**: `python3 -m py_compile apps/api/routers/folders.py` → exit 0.

### Step 5: Integration tests

`apps/api/tests/integration/test_trash_purge_db.py`, modeled on the fixture
style of `test_folder_hierarchy_db.py`, with `s3_service.delete_prefix`
patched (record calls):

1. **Endpoint purges trashed only**: 2 assets, trash 1, empty trash →
   trashed asset's rows GONE (hard), live asset untouched; `delete_prefix`
   called with exactly its three prefixes (`raw/…`, `processed/…`,
   `watermarked/{asset_id}/`).
2. **Restore wins before purge**: trash → restore → empty trash → asset
   survives, no S3 calls for it.
3. **Retention window**: one asset trashed "45 days ago" (set `deleted_at`
   directly), one trashed now; task-level call with
   `older_than = now - 30d` purges only the old one.
4. **Permissions**: editor (non-owner) → 403.
5. **Dry run**: `dry_run=True` reports counts, deletes nothing.
6. **Prefix guard**: `delete_prefix("raw/")` and `delete_prefix("watermarked")`
   raise `ValueError` (unit-style, no DB needed — can live in the same file).
7. **Full FK graph**: purged asset with a metadata value, an approval, a
   notification (one with `comment_id` set on the asset's comment), a
   share-link item, a carousel item, and a comment with one reaction + one
   mention → purge succeeds (no IntegrityError), all those rows gone.
8. **Audit history survives**: purged asset with an asset-scoped `ShareLink`
   carrying an `ShareLinkActivity` row, a `WatermarkSettings` row, and an
   `ActivityLog` row → after purge, ActivityLog row exists with
   `asset_id IS NULL`; the ShareLink row still exists with
   `asset_id IS NULL`, `project_id == owning_project_id`,
   `is_enabled = false`, `deleted_at` set (check constraint satisfied); its
   ShareLinkActivity and WatermarkSettings rows are untouched.

**Verify**: `TEST_DATABASE_URL=... python -m pytest apps/api/tests/integration/test_trash_purge_db.py -v` → 8 pass.

## Test plan

Covered in Step 5. Existing trash/restore tests
(`test_folder_hierarchy_db.py` etc.) must stay green — purge must not change
soft-delete/restore behavior.

## Done criteria

- [ ] `python3 -m py_compile` green on all touched files
- [ ] `delete_prefix` exists with the broad-prefix guard; guard test passes
- [ ] `POST /projects/{id}/trash/empty` exists, owner-gated
- [ ] `purge_expired_trash` beat entry present; `TRASH_RETENTION_DAYS` in both `.env.example`s
- [ ] ≥8 new integration tests pass (or skip cleanly without env)
- [ ] `ActivityLog` rows survive purge with nulled `asset_id`; `ShareLinkActivity` untouched
- [ ] Full API suite green in CI
- [ ] `git status` clean outside in-scope list; `plans/README.md` updated

## STOP conditions

Stop and report back (do not improvise) if:

- The FK graph around Asset contains a model beyond the "Full FK graph"
  list in Current state (re-run
  `grep -rn "assets.id\|asset_id" apps/api/models/` and compare) — the
  hard-delete order must be re-derived, not guessed.
- Any S3 key for an asset's media exists OUTSIDE the three documented
  prefixes (check `grep -rn "s3_key\|_key = " apps/api/routers/upload.py
  apps/api/tasks/` for key construction you don't recognize).
- Hard-deleting rows trips an FK constraint in tests — report the constraint,
  don't switch to `ON DELETE CASCADE` migrations on your own.

Resolved 2026-07-13 (no longer STOP conditions): incomplete FK list —
now fully mapped above; `watermarked/` prefix — now in scope; audit-history
semantics — maintainer chose SET NULL + keep (see Step 2.3.6).

Resolved 2026-07-13 pm (second executor STOP, all three edges confirmed
against models): `WatermarkSettings.share_link_id` and
`ShareLinkActivity.share_link_id` — moot, ShareLink rows now survive as
soft-deleted + retargeted (Step 2.3.3/2.3.5); `Notification.comment_id` —
notifications now deleted first (Step 2.3.1).

Resolved 2026-07-13 pm (third executor STOP, confirmed against migration
`e8f9a0b1c2d3`): check constraint `ck_share_link_asset_or_folder_or_project`
forbids fully detached links — surviving links are now retargeted to the
owning `project_id` in the same UPDATE (Step 2.3.3/2.3.5, test 8).

## Maintenance notes

- **First hard-delete path in the codebase** — reviewers: verify every query
  in the purge core has BOTH `deleted_at IS NOT NULL` and the age filter, and
  that the endpoint path can never see other projects' rows.
- Follow-ups deferred: web "Empty trash" button + storage-usage display;
  incomplete-multipart sweeps (bucket lifecycle rule or an abort task);
  purging old *versions* of live assets (space win, different UX contract).
- If asset types gain new S3 locations (e.g. subtitle sidecars), the purge
  prefixes must be extended in the same PR.
