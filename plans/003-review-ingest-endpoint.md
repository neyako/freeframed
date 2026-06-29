# Plan 003: Service-to-service ingest endpoint (push a draft video, get a reviewer link)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat dfa0ab1..HEAD -- apps/api/routers/upload.py apps/api/services/s3_service.py apps/api/main.py apps/api/config.py`
> Compare the "Current state" excerpts against the live code on any change; on a
> mismatch, treat it as a STOP condition.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/002-reviewer-safe-share.md (imports `create_reviewer_share`)
- **Category**: feature / migration (integration)
- **Planned at**: commit `dfa0ab1`, 2026-06-28

## Why this matters

In the decided architecture, projmgmt is the hub and FreeFrame is a companion review service.
When a project moves `Editing → Review`, projmgmt must hand FreeFrame the **final/draft video**
and get back a **reviewer-safe guest link** to store in `Project.reviewLink`. projmgmt has no
FreeFrame user account and must not, so the call is authenticated machine-to-machine with a
shared API key — not a user JWT. This plan adds: (1) an API-key auth dependency, (2) an
`upload_fileobj` S3 helper for server-side streaming uploads, and (3) one endpoint that accepts
a video file, creates an asset + version + media file, kicks off the existing transcode
pipeline, mints a reviewer-safe share via Plan 002's helper, and returns the public review URL —
all in a single call. Plan 004 (projmgmt side) consumes this endpoint.

## Current state

### `apps/api/routers/upload.py` — the existing user-driven flow to mirror

The browser flow is multipart-presign (initiate → presign parts → complete). The ingest endpoint
does the **same DB record creation** but uploads the bytes server-side instead of handing the
browser presigned URLs. Key excerpt — how an asset/version/media-file is created and how the S3
key is shaped (lines ~52–98):

```python
        asset = Asset(
            project_id=body.project_id,
            name=body.asset_name,
            asset_type=asset_type,
            created_by=current_user.id,
            folder_id=body.folder_id,
        )
        db.add(asset)
        db.flush()

    last_version = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
    ).order_by(AssetVersion.version_number.desc()).first()
    next_version_number = (last_version.version_number + 1) if last_version else 1

    version = AssetVersion(
        asset_id=asset.id,
        version_number=next_version_number,
        processing_status=ProcessingStatus.uploading,
        created_by=current_user.id,
    )
    db.add(version)
    db.flush()

    ext = os.path.splitext(body.original_filename)[1].lower()
    s3_key = f"raw/{body.project_id}/{asset.id}/{version.id}/original{ext}"

    upload_id = create_multipart_upload(s3_key, body.mime_type)

    file_type_map = {AssetType.image: FileType.image, AssetType.audio: FileType.audio, AssetType.video: FileType.video, AssetType.image_carousel: FileType.image}
    media_file = MediaFile(
        version_id=version.id,
        file_type=file_type_map.get(asset.asset_type, FileType.video),
        original_filename=body.original_filename,
        mime_type=body.mime_type,
        file_size_bytes=body.file_size_bytes,
        s3_key_raw=s3_key,
    )
    db.add(media_file)
    db.commit()
```

How processing is triggered after the bytes land (lines ~146–167):

```python
    version.processing_status = ProcessingStatus.processing
    db.commit()
    background_tasks.add_task(_trigger_processing, body.asset_id, body.version_id)
    ...

def _trigger_processing(asset_id: uuid.UUID, version_id: uuid.UUID):
    from ..tasks.transcode_tasks import process_asset
    from ..tasks.celery_app import send_task_safe
    send_task_safe(process_asset, str(asset_id), str(version_id))
```

Allowed MIME types and helpers are in `apps/api/schemas/upload.py`:
`ALLOWED_MIME_TYPES` (video/audio/image), `MAX_FILE_SIZE_BYTES = 10GB`, `mime_to_asset_type(...)`.

### `apps/api/services/s3_service.py`

Uses `boto3` with `settings` from `apps/api/config.py`. Existing helpers: `get_s3_client()`,
`create_multipart_upload`, `put_object(s3_key, body: bytes, ...)`. There is **no** streaming
file-object upload helper yet — you will add `upload_fileobj`.

### `apps/api/config.py`

`Settings(BaseSettings)` reads from `.env`. `frontend_url` exists. There is **no** integration
API key setting yet — you will add `integration_api_key`.

### `apps/api/main.py`

Routers are imported (line 6) and registered with `app.include_router(...)` (lines 44–60). You
will add an `integrations` router and register it.

### `apps/api/models/project.py`

`Project.created_by: Mapped[uuid.UUID]` (FK to users) — line 29. The ingest endpoint has no
`current_user`, so it attributes the asset/version/share to **`project.created_by`** (the
project owner). `ProjectRole.owner` / `ProjectRole.editor` enums exist in this file.

**Conventions:** see Plan 002's "Conventions" — same router/schema/test patterns. API-key
comparison must be constant-time (`hmac.compare_digest`). Server-side uploads of multi-GB files
must stream (never load the whole file into memory).

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`) | Expected |
|---------|-------------------------------------------|----------|
| API tests (all) | `python -m pytest apps/api/tests -q` | all pass |
| API tests (this) | `python -m pytest apps/api/tests/test_integration_ingest.py -q` | new tests pass |
| Import sanity | `python -c "import apps.api.routers.integrations"` (deps installed) | exit 0 |

If you cannot run pytest, STOP — do not ship an untested S2S endpoint.

## Scope

**In scope**:
- `apps/api/config.py` — add `integration_api_key: str | None = None`.
- `apps/api/services/s3_service.py` — add `upload_fileobj(...)`.
- `apps/api/middleware/api_key.py` (create) — `require_integration_key` dependency.
- `apps/api/routers/integrations.py` (create) — the ingest endpoint.
- `apps/api/schemas/integrations.py` (create) — response schema.
- `apps/api/main.py` — import + register the new router.
- `apps/api/tests/test_integration_ingest.py` (create) — tests.
- `.env.example` — document `INTEGRATION_API_KEY` (placeholder only — never a real value).

**Out of scope**:
- `apps/api/routers/upload.py` — leave the browser flow untouched.
- `apps/api/tasks/**` — reuse `process_asset` / `send_task_safe` as-is; do not modify the
  transcoder.
- The reviewer-share logic — import `create_reviewer_share` from Plan 002; do not reimplement it.

## Git workflow

- Branch: `advisor/003-review-ingest-endpoint`
- Conventional commits, e.g. `feat(api): add S2S review-ingest endpoint with API-key auth`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the API-key setting

In `apps/api/config.py`, add to `Settings`:

```python
    # Service-to-service integration (e.g. projmgmt → FreeFrame review bridge).
    # When unset, the integration endpoints reject all requests (closed by default).
    integration_api_key: str | None = None
```

**Verify**: `python -c "from apps.api.config import settings; print(hasattr(settings, 'integration_api_key'))"` → `True`.

### Step 2: Add the API-key auth dependency

Create `apps/api/middleware/api_key.py`:

```python
import hmac
from fastapi import Header, HTTPException, status
from ..config import settings


def require_integration_key(x_api_key: str | None = Header(default=None)) -> None:
    """Reject unless a valid integration API key is presented.

    Closed by default: if INTEGRATION_API_KEY is unset on the server, every
    request is rejected (no accidental open endpoint).
    """
    expected = settings.integration_api_key
    if not expected:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Integration API not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid integration API key")
```

**Verify**: `python -c "from apps.api.middleware.api_key import require_integration_key"` → exit 0.

### Step 3: Add the streaming S3 upload helper

In `apps/api/services/s3_service.py`, add:

```python
def upload_fileobj(s3_key: str, fileobj, content_type: str | None = None) -> None:
    """Stream a file-like object to S3 (handles multipart for large files).

    `fileobj` must be a binary, seekable-or-streamable file object (e.g. a
    SpooledTemporaryFile from FastAPI's UploadFile.file). boto3 chunks it.
    """
    s3 = get_s3_client()
    extra = {"ContentType": content_type} if content_type else None
    s3.upload_fileobj(fileobj, settings.s3_bucket, s3_key, ExtraArgs=extra)
```

**Verify**: `grep -n "def upload_fileobj" apps/api/services/s3_service.py` → one match.

### Step 4: Add the ingest response schema

Create `apps/api/schemas/integrations.py`:

```python
import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ReviewIngestResponse(BaseModel):
    asset_id: uuid.UUID
    version_id: uuid.UUID
    version_number: int
    token: str
    url: str  # public reviewer URL: {frontend_url}/share/{token}
    expires_at: Optional[datetime] = None
```

**Verify**: `python -c "from apps.api.schemas.integrations import ReviewIngestResponse"` → exit 0.

### Step 5: Add the ingest router

Create `apps/api/routers/integrations.py`. It mirrors `upload.py`'s record creation, streams the
file to S3 with `upload_fileobj`, triggers transcoding, then mints a reviewer-safe share via
Plan 002's `create_reviewer_share`.

```python
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form,
                     HTTPException, UploadFile, status)
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..middleware.api_key import require_integration_key
from ..models.asset import (Asset, AssetVersion, MediaFile, AssetType,
                            ProcessingStatus, FileType)
from ..models.project import Project
from ..models.share import SharePermission
from ..schemas.integrations import ReviewIngestResponse
from ..schemas.upload import ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, mime_to_asset_type
from ..services.s3_service import upload_fileobj
from .share import create_reviewer_share

router = APIRouter(prefix="/integrations", tags=["integrations"],
                  dependencies=[Depends(require_integration_key)])


def _trigger_processing(asset_id: uuid.UUID, version_id: uuid.UUID):
    from ..tasks.transcode_tasks import process_asset
    from ..tasks.celery_app import send_task_safe
    send_task_safe(process_asset, str(asset_id), str(version_id))


@router.post("/review-ingest", response_model=ReviewIngestResponse,
             status_code=status.HTTP_201_CREATED)
async def review_ingest(
    background_tasks: BackgroundTasks,
    project_id: uuid.UUID = Form(...),
    asset_name: str = Form(...),
    mime_type: str = Form(...),
    file: UploadFile = File(...),
    permission: SharePermission = Form(SharePermission.comment),
    allow_download: bool = Form(False),
    db: Session = Depends(get_db),
):
    """Push a draft video and receive a reviewer-safe single-video share link.

    Authenticated by the X-Api-Key header (require_integration_key). The asset is
    attributed to the project owner (project.created_by); no end-user account is involved.
    """
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {mime_type}")

    project = db.query(Project).filter(Project.id == project_id,
                                       Project.deleted_at.is_(None)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    owner_id = project.created_by

    asset = Asset(
        project_id=project_id,
        name=asset_name,
        asset_type=mime_to_asset_type(mime_type),
        created_by=owner_id,
        folder_id=None,
    )
    db.add(asset)
    db.flush()

    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.uploading,
        created_by=owner_id,
    )
    db.add(version)
    db.flush()

    original_filename = file.filename or f"{asset_name}"
    ext = os.path.splitext(original_filename)[1].lower()
    s3_key = f"raw/{project_id}/{asset.id}/{version.id}/original{ext}"

    # Stream the upload straight to S3 (handles multi-GB via multipart).
    upload_fileobj(s3_key, file.file, mime_type)

    file_type_map = {AssetType.image: FileType.image, AssetType.audio: FileType.audio,
                     AssetType.video: FileType.video, AssetType.image_carousel: FileType.image}
    media_file = MediaFile(
        version_id=version.id,
        file_type=file_type_map.get(asset.asset_type, FileType.video),
        original_filename=original_filename,
        mime_type=mime_type,
        file_size_bytes=file.size or 0,
        s3_key_raw=s3_key,
    )
    db.add(media_file)
    version.processing_status = ProcessingStatus.processing
    db.commit()
    db.refresh(asset)
    db.refresh(version)

    background_tasks.add_task(_trigger_processing, asset.id, version.id)

    link = create_reviewer_share(
        db,
        asset=asset,
        created_by=owner_id,
        permission=permission,
        allow_download=allow_download,
    )

    return ReviewIngestResponse(
        asset_id=asset.id,
        version_id=version.id,
        version_number=version.version_number,
        token=link.token,
        url=f"{settings.frontend_url.rstrip('/')}/share/{link.token}",
        expires_at=link.expires_at,
    )
```

**Verify**:
- `python -c "import apps.api.routers.integrations"` → exit 0.
- Confirm `MediaFile` accepts `file_size_bytes` and `s3_key_raw` exactly as named (cross-check
  `apps/api/models/asset.py`). If `Project` has no `deleted_at`, drop that filter clause and note
  it. If `MediaFile`/`AssetVersion`/`Asset` field names differ from upload.py's usage, STOP —
  upload.py is the source of truth for these names; they must match.

### Step 6: Register the router

In `apps/api/main.py`, add `integrations` to the import on line 6 and add
`app.include_router(integrations.router)` alongside the others (after `share.router` is fine).

**Verify**: `grep -n "integrations.router" apps/api/main.py` → one match.

### Step 7: Document the env var

In `.env.example`, add (placeholder only — NEVER a real key):

```
# Service-to-service key for the projmgmt → FreeFrame review bridge.
# Generate with: openssl rand -hex 32   (set the SAME value on the projmgmt side)
INTEGRATION_API_KEY=
```

**Verify**: `grep -n "INTEGRATION_API_KEY" .env.example` → one match.

### Step 8: Tests

Create `apps/api/tests/test_integration_ingest.py`, patterned on `apps/api/tests/test_share_session.py`
and `apps/api/tests/conftest.py`. Set `settings.integration_api_key` to a known test value
(monkeypatch or override the dependency the way conftest overrides auth — read conftest to see how
dependency overrides are done). Cover:

1. **No key / wrong key** → 401; **server key unset** → 503.
2. **Happy path**: valid `X-Api-Key`, multipart POST with a tiny fake `video/mp4` file to
   `/integrations/review-ingest` with a valid `project_id` → 201; response `url` ends with
   `/share/{token}`; a new `Asset`, `AssetVersion` (number 1), and `MediaFile` row exist; the
   `ShareLink` is asset-scoped with `show_versions is False` (the Plan 002 guarantee).
3. **Unknown project_id** → 404.
4. **Disallowed mime** (e.g. `application/zip`) → 400.

For the S3 upload and transcode trigger, stub them so tests don't need MinIO/Celery: monkeypatch
`apps.api.routers.integrations.upload_fileobj` and `apps.api.routers.integrations._trigger_processing`
to no-ops. (Read conftest first — it may already stub S3.)

**Verify**: `python -m pytest apps/api/tests/test_integration_ingest.py -q` → all pass.

### Step 9: Full suite

**Verify**: `python -m pytest apps/api/tests -q` → all pass.

## Test plan

(Step 8.) New file `apps/api/tests/test_integration_ingest.py`. Load-bearing cases: auth
rejection (#1) and the happy-path asset-scoped share (#2). S3 and Celery are stubbed so the test
is hermetic.

## Done criteria

ALL must hold:

- [ ] `python -m pytest apps/api/tests -q` exits 0; `test_integration_ingest.py` exists with ≥4 passing tests
- [ ] `grep -n "def upload_fileobj" apps/api/services/s3_service.py` → match
- [ ] `grep -n "review-ingest" apps/api/routers/integrations.py` → match
- [ ] `grep -n "integrations.router" apps/api/main.py` → match
- [ ] `grep -n "INTEGRATION_API_KEY" .env.example` → match, value blank
- [ ] API-key check uses `hmac.compare_digest` and rejects when the server key is unset
- [ ] No real secret value appears anywhere in the diff
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back if:

- `create_reviewer_share` is not importable from `apps.api.routers.share` (Plan 002 not landed —
  do 002 first).
- `Asset` / `AssetVersion` / `MediaFile` field names don't match upload.py's usage.
- `Project` has no `created_by` column (the attribution model assumed here is wrong).
- The transcode task import path (`apps.api.tasks.transcode_tasks.process_asset` /
  `apps.api.tasks.celery_app.send_task_safe`) differs from upload.py's.
- A step's verification fails twice after a reasonable fix.

## Maintenance notes

- This endpoint trusts the API key fully and attributes work to the project owner. If you later
  need per-reviewer-batch attribution or multiple projmgmt instances, introduce a dedicated
  service-user table rather than overloading `project.created_by`.
- Files stream via `UploadFile.file` → `upload_fileobj`; that keeps memory flat for multi-GB
  drafts. Don't "simplify" it to `await file.read()` — that buffers the whole file in RAM.
- The endpoint maps one ingest → one new asset (version 1). If projmgmt later wants resubmitted
  drafts to become *version N+1 of the same FreeFrame asset* (so reviewers see history), add an
  optional `asset_id` form field and reuse upload.py's `next_version_number` logic — deferred
  here to keep the contract simple (projmgmt increments its own `draftVersion` instead).
- Reviewer should scrutinise: closed-by-default auth (503 when key unset), constant-time compare,
  and that the minted share is asset-scoped (no folder/project leak).
- The matching projmgmt env var and call site are Plan 004.
