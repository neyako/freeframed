# Plan 085: Adopt upstream "Export comments to your NLE" (EDL / FCPXML / Premiere XML / CSV)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat da5e1f9..HEAD -- packages/transcoder apps/api/tasks/transcode_tasks.py apps/api/routers/comments.py apps/api/main.py apps/web/components/review/comment-panel.tsx apps/web/lib`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M–L
- **Risk**: MED (touches the transcode task and the review-panel component; export endpoint itself is additive)
- **Depends on**: none
- **Category**: direction (upstream feature adoption)
- **Planned at**: commit `da5e1f9`, 2026-07-21

## Why this matters

Upstream FreeFrame shipped comment export as NLE timeline markers
([PR #151](https://github.com/Techiebutler/freeframe/pull/151) — API,
[PR #152](https://github.com/Techiebutler/freeframe/pull/152) — web UI,
both closing upstream issue #84). A reviewer's timecoded comments download as
a marker file the editor imports directly: DaVinci Resolve (marker EDL),
Final Cut Pro (FCPXML 1.9), Premiere Pro (FCP7 XML), or CSV.

This fork already has a Resolve-only comment sync (`tools/resolve`, plan 007)
— but it requires installing scripts inside Resolve's console and only serves
Resolve. The upstream feature is a one-click browser download that serves all
three NLEs plus CSV, which fits the homelab/creator audience exactly. The two
are complementary; this plan does not touch `tools/resolve`.

**Hidden prerequisite**: upstream's export reads `MediaFile.fps`, persisted
by upstream [PR #150](https://github.com/Techiebutler/freeframe/pull/150).
This fork has the `fps`/`duration_seconds` columns
([apps/api/models/asset.py:84-85](../apps/api/models/asset.py)) but **nothing
ever writes them** — `_process_video` in
[apps/api/tasks/transcode_tasks.py:94-127](../apps/api/tasks/transcode_tasks.py)
only stores `s3_key_processed`/`s3_key_thumbnail`. So this plan lands in three
phases: (A) persist media metadata on transcode + backfill task (port of
upstream #150, adapted to this fork's hwaccel transcoder), (B) the export API
(port of #151), (C) the review-panel UI (port of #152, adapted to this fork's
guest-share usage of `CommentPanel`).

## Current state

**Fork facts (verified at `da5e1f9`):**

- `apps/api/models/asset.py:70-87` — `MediaFile` already has
  `width`, `height`, `duration_seconds`, `fps` (all nullable). **No migration
  needed.** Identical shape to upstream.
- `apps/api/tasks/transcode_tasks.py` — Celery `process_asset` task.
  `_process_video` (line 94) calls `FFmpegTranscoder.transcode(job,
  progress_callback=...)` via `_run_async`, then only sets
  `media_file.s3_key_processed` and `s3_key_thumbnail` (lines 124-127).
  `_process_audio` (line 130) calls `packages.transcoder.image_processor.process_audio`
  and stores `mp3_key`/`waveform_key` only.
- `packages/transcoder/base.py` — `TranscodeResult` dataclass has NO metadata
  fields (only `success`, `hls_prefix`, `thumbnail_keys`, `waveform_key`,
  `error`). `VideoMetadata` dataclass (duration/width/height/fps) already
  exists.
- `packages/transcoder/ffmpeg_transcoder.py` — fork's transcoder has hwaccel
  support (constructor takes `hwaccel`, `vaapi_device`; `transcode()` tries
  vaapi→software attempt ladder). **It already runs the exact probe we need**
  at lines 140-152 of `transcode()`:

  ```python
  cmd = [
      "ffprobe", "-v", "quiet", "-print_format", "json",
      "-show_format", "-show_streams", "-select_streams", "v:0", input_url,
  ]
  probe = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
  duration = 0.0
  try:
      probe_data = json.loads(probe.stdout)
      duration = float(probe_data.get("streams", [{}])[0].get("duration", 0) or 0)
      ...
  ```

  and returns `TranscodeResult(success=True, hls_prefix=..., thumbnail_keys=[...])`
  at lines 243-247. `get_video_metadata` (line 83) fabricates 30fps when
  `r_frame_rate` is missing — do NOT copy that behavior into the new parser.
- `apps/api/routers/comments.py` — auth'd comment endpoints. Already imports
  `Query`, `re`, `uuid`, `AssetVersion`, `ProcessingStatus`, `GuestUser`,
  `User`, `require_asset_access` (line 38), and has helper
  `_get_asset(db, asset_id)` (line 51) that 404s on missing/deleted assets.
  It does NOT import `Response`, `quote`, `logging`, `AssetType`, `MediaFile`.
- `apps/api/main.py:53-59` — CORS middleware has NO `expose_headers`; the
  browser can't read `Content-Disposition` without it:

  ```python
  app.add_middleware(
      CORSMiddleware,
      allow_origins=get_cors_origins(),
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  ```
- `apps/api/models/comment.py` — `Comment.timecode_start`/`timecode_end` are
  Float seconds (nullable), `resolved` bool, plus a fork-specific
  `visibility` column (`public`/`internal`). Upstream has no visibility
  column; the export endpoint below intentionally includes internal comments
  (it is members-only — same exposure as the members' comment list).
- `apps/web/components/review/comment-panel.tsx` (~1290 lines) — fork's panel
  closely matches upstream's: local `Dropdown` wrapper (line 123), toolbar
  state `visOpen`/`filterOpen`/`sortOpen` (lines 794-796), sort dropdown ends
  ~line 1124. **Fork divergence**: `CommentPanel` is ALSO rendered in the
  guest share viewer (`apps/web/components/share/folder-share-viewer.tsx`,
  dynamic import ~line 633) where users may be unauthenticated guests — the
  export endpoint would 401/403 there. The upstream port must be gated behind
  a new prop (Step C2).
- `apps/web/stores/review-store.ts:8-9` — store exposes `currentAsset` and
  `currentVersion`; populated in both the dashboard review page and the share
  viewer.
- `apps/web/lib/auth.ts:14` — `getAccessToken(): string | null` exists (what
  upstream's `lib/export-comments.ts` imports).
- `apps/web/package.json` — `@radix-ui/react-dialog: ^1.1.14` present;
  `components/ui/button.tsx` exists. Dashboard review page
  `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` renders
  `<CommentPanel comments={...} currentUserId={user?.id} ... />` at ~line 546.
- API tests: `apps/api/tests/conftest.py` mocks the DB session (MagicMock) —
  upstream's test suite uses the same approach (same lineage), so upstream's
  export tests are expected to port with at most import-path tweaks.
- The fork's `CHANGELOG.md` is stale (last entry 2026-04) — do NOT add
  changelog entries; the fork records history in git + `plans/`.

**Upstream implementation (all files on upstream `main`, merged via PRs
#150/#151/#152):**

- `apps/api/services/comment_export.py` (295 lines) — pure stdlib serializer
  module: `FpsSpec` + `FPS_TABLE` (23.976→60, NTSC drop-frame handling),
  `snap_fps`, `seconds_to_frames`, `frames_to_tc`, `tc_to_frames`,
  `CommentRow`, `Marker`, `build_markers` (replies fold into marker note,
  same-frame comments merge), `to_csv` (BOM handled by router), `to_edl`
  (CMX 3600, 999-event cap, Resolve color codes), `to_fcpxml` (markers on a
  media-less gap), `to_premiere_xml` (xmeml sequence markers). No DB, no
  fork-specific imports — **copy verbatim**.
- `apps/api/routers/comments.py` — `GET /assets/{asset_id}/comments/export`
  endpoint (full adapted code inlined in Step B2 below).
- `apps/api/main.py` — adds `expose_headers=["Content-Disposition"]`.
- `apps/api/tasks/transcode_tasks.py` — persists probe metadata in
  `_process_video`/`_process_audio` + a `backfill_media_metadata` Celery task;
  `apps/api/scripts/backfill_media_metadata.py` enqueues it.
- `packages/transcoder/ffmpeg_transcoder.py` — adds module-level
  `parse_probe_metadata(data) -> Optional[VideoMetadata]` (guards `0/0` frame
  rates, falls back to format-level duration, returns None without a video
  stream, fps stays 0.0 when unknown — never fabricates 30).
- `packages/transcoder/base.py` — `TranscodeResult` gains
  `duration_seconds/width/height/fps` optional fields.
- `packages/transcoder/image_processor.py` — `process_audio` probes duration
  via ffprobe (wrapped so a failed probe never fails audio processing).
- Web: `apps/web/lib/export-comments.ts` (fetch + blob download +
  `FpsRequiredError`), `apps/web/components/review/fps-prompt-dialog.tsx`
  (radix dialog, 9 fps presets), export dropdown wired into
  `comment-panel.tsx`.
- Tests: `apps/api/tests/test_comment_export_formats.py` (golden EDL vector,
  FCPXML/xmeml structure), `test_comment_export_markers.py`,
  `test_comment_export_timecode.py` (drop-frame reference constants: 1 hour
  @29.97 DF = 107,892×… — see file), `test_comments_export_endpoint.py`,
  `test_transcode_metadata_persist.py`, `test_probe_metadata.py`,
  `test_backfill_media_metadata.py`; web:
  `apps/web/lib/__tests__/export-comments.test.ts`,
  `apps/web/components/review/__tests__/fps-prompt-dialog.test.tsx`.

**Fetching upstream sources** (no upstream git remote is configured; use the
GitHub API):

```bash
mkdir -p /tmp/upstream
for f in \
  apps/api/services/comment_export.py \
  apps/api/tests/test_comment_export_formats.py \
  apps/api/tests/test_comment_export_markers.py \
  apps/api/tests/test_comment_export_timecode.py \
  apps/api/tests/test_comments_export_endpoint.py \
  apps/api/tests/test_transcode_metadata_persist.py \
  apps/api/tests/test_probe_metadata.py \
  apps/api/tests/test_backfill_media_metadata.py \
  apps/api/scripts/backfill_media_metadata.py \
  apps/web/lib/export-comments.ts \
  apps/web/components/review/fps-prompt-dialog.tsx ; do
  gh api "repos/Techiebutler/freeframe/contents/$f" \
    -H "Accept: application/vnd.github.raw" > "/tmp/upstream/$(basename $f)"
done
wc -l /tmp/upstream/comment_export.py   # expect ~295
```

Also fetch the three PR diffs for reference while adapting:
`gh pr diff 150 --repo Techiebutler/freeframe`, same for `151` and `152`.
Sanity-check each fetched file's first lines look like the descriptions above;
if `comment_export.py` is not ~295 lines or lacks `FPS_TABLE`, upstream moved
— STOP.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API syntax check | `python3 -m py_compile <changed .py files>` | exit 0, no output |
| API tests (CI is the real gate; run locally only if deps installed) | `python -m pytest apps/api/tests/ -v` | all pass |
| Web install | `pnpm install` (in `apps/web/`, pnpm ONLY — never npm) | exit 0 |
| Web tests | `pnpm test` (in `apps/web/`) | all pass (230+ before this plan) |
| Web types | `pnpm exec tsc --noEmit` (in `apps/web/`) | 0 errors |
| Web lint | `pnpm lint` (in `apps/web/`) | no NEW errors (warnings pre-exist) |
| Web build | `pnpm build` (in `apps/web/`) | exit 0 |

The maintainer's machine has no Python venv — `py_compile` is the local gate;
pytest runs in CI. Never run `npm install`.

## Scope

**In scope** (the only files you should modify or create):

- `packages/transcoder/base.py` (edit)
- `packages/transcoder/ffmpeg_transcoder.py` (edit)
- `packages/transcoder/image_processor.py` (edit)
- `apps/api/tasks/transcode_tasks.py` (edit)
- `apps/api/scripts/backfill_media_metadata.py` (create)
- `apps/api/services/comment_export.py` (create)
- `apps/api/routers/comments.py` (edit — additive only)
- `apps/api/main.py` (edit — one line)
- `apps/api/tests/test_comment_export_formats.py`, `test_comment_export_markers.py`, `test_comment_export_timecode.py`, `test_comments_export_endpoint.py`, `test_transcode_metadata_persist.py`, `test_probe_metadata.py`, `test_backfill_media_metadata.py` (create)
- `apps/web/lib/export-comments.ts` (create)
- `apps/web/lib/__tests__/export-comments.test.ts` (create)
- `apps/web/components/review/fps-prompt-dialog.tsx` (create)
- `apps/web/components/review/__tests__/fps-prompt-dialog.test.tsx` (create)
- `apps/web/components/review/comment-panel.tsx` (edit)
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` (edit — pass one prop)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):

- `tools/resolve/**` — the existing Resolve sync (plan 007) stays as-is.
- `apps/api/routers/share.py` and any guest/share export path — guest export
  is a deliberate follow-up (needs `validate_asset_in_share` +
  `link.allow_download` gating); this plan is members-only.
- `apps/web/components/share/folder-share-viewer.tsx` — the export button
  must simply not appear there (prop defaults off, Step C2).
- `packages/transcoder/hwaccel.py`, the attempt-ladder logic, and
  `get_video_metadata`'s existing behavior — don't refactor them.
- `CHANGELOG.md` — stale in this fork; skip.
- Visual restyling of any component — plans 034–040 own the retheme. Copy the
  existing styling idiom of neighboring components verbatim.
- Alembic migrations — none needed (columns already exist). If you find
  yourself writing one, STOP.

## Git workflow

- Branch: `advisor/085-nle-comment-export` off `main`.
- Conventional commits with scope, one per phase, e.g.:
  - `feat(transcoder): persist media metadata on transcode + backfill task`
  - `feat(comments): export comments as NLE markers — EDL/FCPXML/Premiere XML/CSV`
  - `feat(web): export-comments menu in review panel + fps prompt`
- Do NOT push or merge — the maintainer merges.

## Steps

### Phase A — persist media metadata (port of upstream #150)

#### Step A1: extend `TranscodeResult`

In `packages/transcoder/base.py`, add to `TranscodeResult`:

```python
    duration_seconds: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
```

**Verify**: `python3 -m py_compile packages/transcoder/base.py` → exit 0.

#### Step A2: `parse_probe_metadata` + populate the result

In `packages/transcoder/ffmpeg_transcoder.py`, add a module-level function
(above the `FFmpegTranscoder` class; import `Optional` and `VideoMetadata`
are already available in the module):

```python
def parse_probe_metadata(data: dict) -> Optional[VideoMetadata]:
    """Parse ffprobe JSON (-show_streams -show_format) into VideoMetadata.

    Returns None when there is no video stream. Guards r_frame_rate "0/0"
    (fps stays 0.0 — never fabricate a rate) and falls back to format-level
    duration when the stream lacks one (common for MKV/WebM).
    """
    streams = data.get("streams") or []
    if not streams:
        return None
    stream = streams[0]
    fps = 0.0
    raw_rate = stream.get("r_frame_rate") or ""
    if "/" in raw_rate:
        num, _, den = raw_rate.partition("/")
        try:
            if float(den) != 0:
                fps = float(num) / float(den)
        except ValueError:
            fps = 0.0
    duration = float(stream.get("duration") or 0)
    if not duration:
        duration = float((data.get("format") or {}).get("duration") or 0)
    return VideoMetadata(
        duration_seconds=duration,
        width=int(stream.get("width") or 0),
        height=int(stream.get("height") or 0),
        fps=fps,
    )
```

Then in `transcode()` (the existing probe block at ~lines 144-152 already
produces `probe_data`): after the existing `duration` extraction, add
`meta = None` before the `try:` and inside the `try` (after parsing
`probe_data`) set `meta = parse_probe_metadata(probe_data)`; keep the existing
`except` clause resetting `duration = 0.0` (add `meta = None` there too).
Finally extend the success return (lines 243-247) to:

```python
            return TranscodeResult(
                success=True,
                hls_prefix=job.output_s3_prefix,
                thumbnail_keys=[thumbnail_key],
                duration_seconds=(meta.duration_seconds or None) if meta else None,
                width=(meta.width or None) if meta else None,
                height=(meta.height or None) if meta else None,
                fps=(meta.fps or None) if meta else None,
            )
```

Do NOT change the fabricated-30fps default inside `get_video_metadata` — out
of scope.

**Verify**: `python3 -m py_compile packages/transcoder/ffmpeg_transcoder.py` → exit 0.

#### Step A3: audio duration probe

In `packages/transcoder/image_processor.py` → `process_audio`, after the
input file is downloaded to `tmp_input` and before the MP3 conversion, probe
duration (ensure `import json` and `import logging` exist at module top;
add `log = logging.getLogger(__name__)` if missing):

```python
        # Probe duration before processing (#124 upstream)
        duration_seconds = None
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", tmp_input],
                check=True, capture_output=True, text=True, timeout=120,
            )
            duration_seconds = float(json.loads(probe.stdout).get("format", {}).get("duration") or 0) or None
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, json.JSONDecodeError, OSError, AttributeError) as exc:
            log.warning("audio duration probe failed for %s: %s", input_s3_key, exc)  # a failed probe must not fail audio processing
        result["duration_seconds"] = duration_seconds
```

Adapt placement to the function's actual local names — read the function
first; it must end up in the returned dict alongside `mp3_key`/`waveform_key`.

**Verify**: `python3 -m py_compile packages/transcoder/image_processor.py` → exit 0.

#### Step A4: persist in the Celery task + backfill

In `apps/api/tasks/transcode_tasks.py`:

1. Add `import logging` and `log = logging.getLogger("celery.transcode")` near the top.
2. In `_process_video`, after the existing `media_file.s3_key_*` assignments
   and before `db.flush()`:

   ```python
       if result.duration_seconds:
           media_file.duration_seconds = result.duration_seconds
       if result.width:
           media_file.width = result.width
       if result.height:
           media_file.height = result.height
       if result.fps:
           media_file.fps = result.fps
   ```
3. In `_process_audio`, before `db.flush()`:

   ```python
       if result.get("duration_seconds"):
           media_file.duration_seconds = result["duration_seconds"]
   ```
4. Append the `backfill_media_metadata` Celery task and its `_eligible_media_rows`
   helper — take them verbatim from `gh pr diff 150 --repo Techiebutler/freeframe`
   (the task probes `s3_key_raw` via presigned URL + ffprobe, fills
   NULL-duration rows for video/audio assets, is idempotent, and skips+logs
   per-row failures without aborting the batch). The imports it needs
   (`MediaFile`, `Asset`, `AssetVersion`, `AssetType`, `ProcessingStatus`,
   `get_s3_client`, `settings`, `SessionLocal`, `json`) are already at module
   top; `subprocess` and `parse_probe_metadata` are imported inside the task
   function in the upstream code — keep that.
5. Create `apps/api/scripts/backfill_media_metadata.py` from
   `/tmp/upstream/backfill_media_metadata.py` (14 lines — enqueues the task).
   `apps/api/scripts/__init__.py` already exists.

**Verify**: `python3 -m py_compile apps/api/tasks/transcode_tasks.py apps/api/scripts/backfill_media_metadata.py` → exit 0.

#### Step A5: Phase A tests

Copy `/tmp/upstream/test_transcode_metadata_persist.py`,
`test_probe_metadata.py`, `test_backfill_media_metadata.py` into
`apps/api/tests/`. These use `MagicMock`/`patch` only (no live DB) and import
`apps.api.*`/`packages.transcoder.*` — paths identical in this fork. Read
each; if one references an upstream-only symbol (e.g. a helper this fork
lacks), adapt the mock, not the production code.

**Verify**: `python3 -m py_compile apps/api/tests/test_transcode_metadata_persist.py apps/api/tests/test_probe_metadata.py apps/api/tests/test_backfill_media_metadata.py` → exit 0.
If a local pytest env exists: `python -m pytest apps/api/tests/test_probe_metadata.py apps/api/tests/test_transcode_metadata_persist.py apps/api/tests/test_backfill_media_metadata.py -v` → all pass.

### Phase B — export API (port of upstream #151)

#### Step B1: the serializer service

Copy `/tmp/upstream/comment_export.py` verbatim to
`apps/api/services/comment_export.py`. It is pure stdlib (csv, io, re,
dataclasses, datetime, xml.etree) — no adaptation. Its module docstring
references an upstream spec doc path; leave it (provenance).

**Verify**: `python3 -m py_compile apps/api/services/comment_export.py` → exit 0.

#### Step B2: the endpoint

In `apps/api/routers/comments.py`:

1. Extend imports (top of file):
   - `import logging`
   - `from urllib.parse import quote`
   - add `Response` to the existing `fastapi` import
   - add `AssetType, MediaFile` to the existing `from ..models.asset import …`
   - `from ..services import comment_export`
2. After `router = APIRouter(tags=["comments"])`, add:

   ```python
   log = logging.getLogger(__name__)

   EXPORT_FORMATS = {
       "edl": ("text/plain; charset=utf-8", "edl"),
       "fcpxml": ("application/xml", "fcpxml"),
       "premiere_xml": ("application/xml", "xml"),
       "csv": ("text/csv; charset=utf-8", "csv"),
   }
   _START_TC_RE = re.compile(r"^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$")
   ```
3. Add the endpoint (place it after the existing authenticated comment
   endpoints, BEFORE the `── Guest comments` section so the file's
   member/guest grouping stays intact). This is upstream's code, valid for
   this fork as-is because `_get_asset` / `require_asset_access` / model
   names are identical:

   ```python
   @router.get("/assets/{asset_id}/comments/export")
   def export_comments(
       asset_id: uuid.UUID,
       format: str = Query(...),
       version_id: Optional[uuid.UUID] = Query(default=None),
       fps: Optional[float] = Query(default=None, gt=0),
       start_tc: str = Query(default="01:00:00:00"),
       include_resolved: bool = Query(default=True),
       db: Session = Depends(get_db),
       current_user: User = Depends(get_current_user),
   ):
       """Export a version's comments as NLE timeline markers:
       Resolve marker EDL, FCPXML (Final Cut), FCP7 XML (Premiere), or CSV."""
       if format not in EXPORT_FORMATS:
           raise HTTPException(
               status_code=422,
               detail=f"Unsupported format '{format}'. Use one of: {', '.join(EXPORT_FORMATS)}",
           )

       asset = _get_asset(db, asset_id)
       require_asset_access(db, asset, current_user)

       if version_id is not None:
           version = db.query(AssetVersion).filter(
               AssetVersion.id == version_id,
               AssetVersion.asset_id == asset.id,
               AssetVersion.deleted_at.is_(None),
           ).first()
       else:
           version = db.query(AssetVersion).filter(
               AssetVersion.asset_id == asset.id,
               AssetVersion.processing_status == ProcessingStatus.ready,
               AssetVersion.deleted_at.is_(None),
           ).order_by(AssetVersion.version_number.desc()).first()
       if not version:
           raise HTTPException(status_code=404, detail="Version not found")

       spec = None
       media_file = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()
       if format == "csv":
           stored_fps = media_file.fps if media_file else None
           if fps or stored_fps:
               spec = comment_export.snap_fps(fps or stored_fps)  # None is fine for CSV
       else:
           if asset.asset_type != AssetType.video:
               raise HTTPException(
                   status_code=422,
                   detail="EDL/FCPXML/Premiere XML export is only available for video assets; use format=csv",
               )
           effective_fps = fps or (media_file.fps if media_file else None)
           if not effective_fps:
               raise HTTPException(status_code=422, detail={
                   "code": "fps_required",
                   "message": "Frame rate unknown for this version; pass ?fps= "
                              "(e.g. 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60)",
               })
           spec = comment_export.snap_fps(effective_fps)
           if spec is None:
               raise HTTPException(
                   status_code=422,
                   detail=f"Unsupported frame rate {effective_fps}; supported: "
                          + ", ".join(str(round(s.fps, 3)) for s in comment_export.FPS_TABLE),
               )
           if format == "edl":
               if not _START_TC_RE.match(start_tc):
                   raise HTTPException(status_code=422, detail="start_tc must be HH:MM:SS:FF")
               hh, mm, ss, ff = (int(p) for p in re.split(r"[:;]", start_tc))
               if not (hh <= 23 and mm < 60 and ss < 60 and ff < spec.timebase):
                   raise HTTPException(status_code=422, detail="start_tc out of range for the frame rate")

       comments = db.query(Comment).filter(
           Comment.version_id == version.id,
           Comment.deleted_at.is_(None),
       ).order_by(Comment.created_at.asc()).all()

       user_ids = {c.author_id for c in comments if c.author_id}
       guest_ids = {c.guest_author_id for c in comments if c.guest_author_id}
       users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
       guests = {g.id: g for g in db.query(GuestUser).filter(GuestUser.id.in_(guest_ids)).all()} if guest_ids else {}

       rows = []
       for c in comments:
           author = users.get(c.author_id) or guests.get(c.guest_author_id)
           rows.append(comment_export.CommentRow(
               id=str(c.id),
               parent_id=str(c.parent_id) if c.parent_id else None,
               author_name=(author.name or author.email) if author else "Unknown",
               author_email=author.email if author else "",
               body=c.body,
               timecode_start=c.timecode_start,
               timecode_end=c.timecode_end,
               resolved=bool(c.resolved),
               created_at=c.created_at,
               version_number=version.version_number,
           ))

       duration_frames = 0
       if spec is not None and media_file is not None and media_file.duration_seconds:
           duration_frames = comment_export.seconds_to_frames(media_file.duration_seconds, spec)

       if format == "csv":
           if not include_resolved:
               rows = [r for r in rows if not r.resolved]
           content = "\ufeff" + comment_export.to_csv(rows, spec)  # BOM for Excel
       else:
           markers = comment_export.build_markers(rows, spec, include_resolved)
           if format == "edl":
               if len(markers) > comment_export.EDL_MAX_EVENTS:
                   log.warning(
                       "EDL export for asset %s truncated: %d markers exceed EDL_MAX_EVENTS=%d, "
                       "%d dropped",
                       asset_id, len(markers), comment_export.EDL_MAX_EVENTS,
                       len(markers) - comment_export.EDL_MAX_EVENTS,
                   )
               content = comment_export.to_edl(
                   markers, spec, comment_export.tc_to_frames(start_tc, spec), asset.name)
           elif format == "fcpxml":
               content = comment_export.to_fcpxml(markers, spec, asset.name, duration_frames)
           else:
               content = comment_export.to_premiere_xml(markers, spec, asset.name, duration_frames)

       media_type, ext = EXPORT_FORMATS[format]
       safe_name = re.sub(r"[^\w\-. ]", "_", asset.name, flags=re.ASCII).strip() or "asset"
       filename = f"{safe_name}_v{version.version_number}_comments.{ext}"
       utf8_name = quote(f"{asset.name}_v{version.version_number}_comments.{ext}", safe="")
       return Response(
           content=content,
           media_type=media_type,
           headers={
               "Content-Disposition": (
                   f'attachment; filename="{filename}"; filename*=UTF-8\'\'{utf8_name}'
               )
           },
       )
   ```

   Note the one structural adaptation vs upstream: `media_file` is queried
   once before the `if format == "csv"` branch (upstream queries it in both
   branches; hoisting it is equivalent and satisfies the later
   `duration_frames` read on the CSV path too). Fork's `Comment` rows also
   carry `visibility`; the export deliberately includes internal comments —
   members-only endpoint, same exposure as the members' list view.

4. In `apps/api/main.py`, add `expose_headers=["Content-Disposition"]` to the
   existing `app.add_middleware(CORSMiddleware, ...)` call.

**Verify**: `python3 -m py_compile apps/api/routers/comments.py apps/api/main.py` → exit 0.

#### Step B3: Phase B tests

Copy `/tmp/upstream/test_comment_export_formats.py`,
`test_comment_export_markers.py`, `test_comment_export_timecode.py`,
`test_comments_export_endpoint.py` into `apps/api/tests/`. The first three
are pure-function tests (no conftest dependency). The endpoint test uses the
mock-DB style this fork's conftest shares with upstream; read it against
`apps/api/tests/conftest.py` and an existing router test
(`apps/api/tests/test_comment_batching.py` is the pattern) and adapt fixture
names if they differ. If the endpoint test needs auth fixtures the fork's
conftest doesn't provide, write a smaller endpoint test in the fork's own
style covering: 422 on bad format, 422 `fps_required` when fps is NULL,
`?fps=` override succeeds, non-video + EDL → 422, CSV works for non-video,
`Content-Disposition` two-part filename.

**Verify**: `python3 -m py_compile apps/api/tests/test_comment_export_*.py apps/api/tests/test_comments_export_endpoint.py` → exit 0.
If pytest env exists: `python -m pytest apps/api/tests/ -v` → all pass, no regressions.

### Phase C — review panel UI (port of upstream #152)

#### Step C1: download helper + fps dialog

- Copy `/tmp/upstream/export-comments.ts` to `apps/web/lib/export-comments.ts`
  verbatim — it imports `getAccessToken` from `./auth` and reads
  `NEXT_PUBLIC_API_URL` exactly like this fork's other lib code.
- Copy `/tmp/upstream/fps-prompt-dialog.tsx` to
  `apps/web/components/review/fps-prompt-dialog.tsx`. It uses
  `@radix-ui/react-dialog`, `cn`, and `@/components/ui/button` — all present.
  Compare its Tailwind tokens (`bg-bg-secondary`, `text-text-primary`,
  `border-border`, `bg-accent-muted`…) against this fork's
  `apps/web/components/ui/confirm-dialog.tsx`; if a token doesn't exist in
  the fork's Tailwind config, substitute the closest token used by
  `confirm-dialog.tsx`. Do not otherwise restyle.
- Copy the two upstream test files into `apps/web/lib/__tests__/` and
  `apps/web/components/review/__tests__/` respectively.

**Verify** (in `apps/web/`): `pnpm exec tsc --noEmit` → 0 errors;
`pnpm test -- export-comments fps-prompt` → new tests pass.

#### Step C2: wire the export menu into `CommentPanel` — gated

Port the `comment-panel.tsx` hunks from `gh pr diff 152 --repo
Techiebutler/freeframe`, with ONE fork-specific change: a `showExport`
gate, because this fork renders `CommentPanel` in the guest share viewer
where the endpoint would 401.

1. Add to `CommentPanelProps`: `showExport?: boolean;` (default falsy).
2. Imports: `Download` from `lucide-react`; `exportComments, FpsRequiredError,
   type ExportFormat` from `@/lib/export-comments`; `FpsPromptDialog` from
   `@/components/review/fps-prompt-dialog`.
3. Inside `CommentPanel`: read `currentAsset`/`currentVersion` from
   `useReviewStore`; add state `exportOpen` and `fpsPromptFormat:
   ExportFormat | null`; add the `handleExport(format, fps?)` function
   (closes menu; calls `exportComments`; on `FpsRequiredError` sets
   `fpsPromptFormat`; other errors `console.error`).
4. In the toolbar, after the sort dropdown (~line 1124), add the export
   button + `Dropdown` — wrapped in `{showExport && (…)}`. Menu entries:
   video assets get "DaVinci Resolve (EDL)" / "Final Cut Pro (FCPXML)" /
   "Premiere Pro (XML)"; all types get "CSV" (`currentAsset?.asset_type ===
   "video"` guard). Match the fork's existing dropdown-item classes exactly
   (copy from the adjacent sort dropdown's buttons). Opening it must close
   the sibling dropdowns (`setVisOpen(false)` etc.), matching the existing
   toggles.
5. Wrap the component's return in a fragment and append `<FpsPromptDialog …>`
   after the main `div`, exactly as upstream does.
6. In `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`,
   add `showExport` to the `<CommentPanel …>` invocation (~line 546).
   Do NOT touch `folder-share-viewer.tsx`.

**Verify** (in `apps/web/`): `pnpm exec tsc --noEmit` → 0 errors;
`pnpm test` → all pass; `pnpm lint` → no new errors; `pnpm build` → exit 0.

#### Step C3 (optional, if the dev stack is running): live smoke

`docker compose -f docker-compose.dev.yml up --build`, then as a logged-in
member on a video asset's review page: export EDL (downloads
`{asset}_v{n}_comments.edl`), export CSV; on a share-link guest view confirm
the export button is absent. Skip if no stack — CI + tests gate.

## Test plan

- **Phase A**: upstream's `test_probe_metadata.py` (fps fraction/0-denominator/
  duration-fallback/no-stream), `test_transcode_metadata_persist.py`
  (`_process_video`/`_process_audio` write MediaFile fields, missing metadata
  leaves NULLs), `test_backfill_media_metadata.py` (updates video rows, skips
  failed probes, audio format-duration, per-row exception continues batch).
- **Phase B**: golden EDL byte vector @25fps, drop-frame reference constants
  (29.97/59.94 hour marks), EDL sanitization/999-cap, FCPXML rationals +
  completed flag, xmeml rate/marker math, marker folding/merging/resolved
  filter, CSV columns + no-SMPTE-without-fps; endpoint dispatch/fps
  precedence/error branches (see Step B3 fallback if conftest fights).
- **Phase C**: upstream's `export-comments.test.ts` (URL/auth/params,
  fps_required → `FpsRequiredError`, non-fps 422 detail passthrough, blob
  download + objectURL cleanup) and `fps-prompt-dialog.test.tsx` (9 presets,
  confirm/cancel). Pattern reference for any new web test:
  `apps/web/components/review/__tests__/` neighbors.
- Verification: `pnpm test` all green; `python -m pytest apps/api/tests/ -v`
  green in CI.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `python3 -m py_compile` exits 0 on every changed/created `.py` file
- [ ] `apps/web`: `pnpm exec tsc --noEmit` → 0 errors; `pnpm test` → all pass
      (previous count + ≥8 new web tests); `pnpm build` → exit 0
- [ ] `grep -n "expose_headers" apps/api/main.py` → 1 match
- [ ] `grep -n "comments/export" apps/api/routers/comments.py` → ≥1 match
- [ ] `grep -n "showExport" apps/web/components/review/comment-panel.tsx` → ≥2 matches, and `grep -n "showExport" apps/web/components/share/folder-share-viewer.tsx` → 0 matches
- [ ] `grep -rn "media_file.fps = " apps/api/tasks/transcode_tasks.py` → ≥1 match
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows changes in `comment-panel.tsx`,
  `transcode_tasks.py`, or `ffmpeg_transcoder.py` that contradict the
  "Current state" excerpts.
- Any `gh api`/`gh pr diff` fetch fails (no network / upstream moved) or
  `comment_export.py` is not ~295 lines with `FPS_TABLE` — do not
  reimplement the serializers from memory.
- Upstream's endpoint test file requires conftest fixtures this fork lacks
  AND the Step B3 fallback (write fork-style tests) would exceed ~150 lines —
  report instead.
- You find yourself needing an Alembic migration, editing
  `folder-share-viewer.tsx`, or touching `routers/share.py`.
- `pnpm test` shows failures in files this plan didn't touch.

## Maintenance notes

- **Backfill must be run once after deploy** for pre-existing videos, or every
  old video will hit the fps prompt (and duration-dependent FCPXML/xmeml gaps
  degrade to marker-extent):
  `docker exec <api-or-allinone-container> python -m apps.api.scripts.backfill_media_metadata`
  (enqueues a Celery task on the transcoding queue; in the all-in-one image
  the same container runs the worker). Idempotent — only touches rows with
  NULL `duration_seconds`.
- **Conscious product acceptances** (inherited from upstream, flagged for the
  maintainer): exports include `internal`-visibility comments (members-only
  endpoint; a `?visibility=` filter is a clean follow-up), and the CSV
  includes an `author_email` column.
- **Maintainer decision (2026-07-21): export is members-only, permanently** —
  guests never get an export path; do not add one via `routers/share.py`.
  Guest-authored comments ARE included in members' exports (author resolved
  via `GuestUser`).
- **Follow-up candidates**, deliberately out of scope: an `include_resolved`
  toggle in the UI; surfacing duration/resolution in the asset metadata panel
  now that they're persisted.
- VFR sources (phone footage) can land markers ±1 frame — upstream documents
  this; not a bug.
- Reviewer checklist: the `showExport` gate (share viewer must not render the
  button), the hoisted `media_file` query adaptation in Step B2, and that no
  restyling leaked into `comment-panel.tsx` (plans 034–040 own the retheme).
- Related existing feature: `tools/resolve` "Sync Comments" (plan 007) pulls
  comments into Resolve via API + scripting console. This export is the
  file-based, NLE-agnostic sibling; if comment schema changes (e.g. new
  author types), both need updating.
