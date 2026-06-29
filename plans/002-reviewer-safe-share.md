# Plan 002: Reviewer-safe single-video share (asset scope, no siblings, guest)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat dfa0ab1..HEAD -- apps/api/routers/share.py apps/api/schemas/share.py`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (but Plan 003 depends on this)
- **Category**: feature / security
- **Planned at**: commit `dfa0ab1`, 2026-06-28

## Why this matters

This fork is a client-review tool. A reviewer must only ever see the **one video** the editor
sent — never the whole assets folder, never other versions, never sibling assets. FreeFrame
*already* supports per-asset share links (`ShareLink.asset_id`), and its single-asset reviewer
viewer renders just that asset with no folder grid and no version switcher (verified: the web
`ShareMediaViewer` path shows one asset; `show_versions` is consumed only on the folder/project
path). The gap is that there is no **single, opinionated way to mint a reviewer-safe share** with
the right defaults locked in — asset-scoped, versions hidden, download off, guest comment/approve.
Folder and project shares (which *do* expose the whole grid) remain easy to create by mistake.

This plan adds one server-side helper + one endpoint that always produce a reviewer-safe,
asset-scoped guest share. Plan 003 (the projmgmt bridge ingest) calls the helper directly;
editors can call the endpoint to hand a client a safe link by hand. After this plan there is a
single blessed path that cannot accidentally widen a reviewer's access to a folder or project.

## Current state

### `apps/api/routers/share.py`

Existing asset-share creation (lines 171–210). Note it copies `show_versions`, `allow_download`,
`visibility` etc. straight from the request body — i.e. the caller can set anything:

```python
@router.post("/assets/{asset_id}/share", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_share_link(
    asset_id: uuid.UUID,
    body: ShareLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)

    token = secrets.token_urlsafe(32)
    if body.password:
        pwd_bytes = body.password[:72].encode('utf-8')
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')
        password_encrypted = encrypt_password(body.password)
    else:
        password_hash = None
        password_encrypted = None

    link = ShareLink(
        asset_id=asset_id,
        token=token,
        created_by=current_user.id,
        title=body.title if body.title else asset.name,
        description=body.description,
        expires_at=body.expires_at,
        password_hash=password_hash,
        password_encrypted=password_encrypted,
        permission=body.permission,
        allow_download=body.allow_download,
        show_versions=body.show_versions,
        show_watermark=body.show_watermark,
        appearance=body.appearance.model_dump(),
    )
    db.add(link)
    db.add(ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.shared))
    db.commit()
    db.refresh(link)
    return link
```

Relevant imports already at the top of the file (confirm before editing):
`import secrets`, `import bcrypt`, `from ..models.share import AssetShare, ShareLink, ShareLinkItem, SharePermission, ShareLinkActivity, ShareActivityAction`, `from ..schemas.share import (...)`, `_get_asset`, `require_project_role`, `ProjectRole`, `encrypt_password`, `ActivityLog`, `ActivityAction`. (These are all already used by `create_share_link`, so they are in scope.)

The `frontend_url` setting (the public base URL of the review web app) is in
`apps/api/config.py` as `settings.frontend_url` (default `http://localhost:3000`). A share's
public URL is `{frontend_url}/share/{token}`.

### `apps/api/schemas/share.py`

`SharePermission` enum (from `apps/api/models/share.py`): `view | comment | approve`.
`ShareLinkResponse` already returns `token`, `asset_id`, `show_versions`, `allow_download`,
`permission`, `visibility` (see lines 47–66). You will add a small response schema for the
reviewer endpoint that also returns the fully-formed public URL.

### Web side (no change needed, but verify)

`apps/web/app/share/[token]/page.tsx`: an asset-scoped share (`asset_id` set, `folder_id` and
`project_id` null) renders the single-asset `ShareViewer` → `ShareMediaViewer`, which shows one
asset, no folder grid, no version switcher. `show_versions` is only read on the folder/project
path (lines ~978, ~995). **Confirm this is still true during Step 4; do not edit the web app
unless that verification fails.**

**Conventions:**
- FastAPI routers in `apps/api/routers/` use `@router.post(...)` with a Pydantic `response_model`,
  `db: Session = Depends(get_db)`, and `current_user: User = Depends(get_current_user)`. Match
  the style of `create_share_link` exactly.
- Schemas live in `apps/api/schemas/share.py` as `pydantic.BaseModel` subclasses with
  `model_config = {"from_attributes": True}` where they read from ORM objects.
- Tests live in `apps/api/tests/test_*.py` and use the fixtures in `apps/api/tests/conftest.py`.
  Read `conftest.py` and `apps/api/tests/test_share_session.py` before writing tests — they show
  how to create a user, project, asset, and authenticated client.

## Commands you will need

| Purpose   | Command (run from `/Users/neyako/freeframed`) | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| API tests (all) | `python -m pytest apps/api/tests -q`     | all pass |
| API tests (this) | `python -m pytest apps/api/tests/test_reviewer_share.py -q` | new tests pass |
| Import sanity | `python -c "import apps.api.routers.share"` (from repo root, with API deps installed) | exit 0 |

If `python -m pytest` cannot collect because dependencies aren't installed in your environment,
install them first with `pip install -r apps/api/requirements.txt` inside the API's virtualenv,
or run the API test container per `docker-compose.dev.yml`. If you cannot run pytest at all,
STOP and report — do not ship an API change you could not test.

## Scope

**In scope**:
- `apps/api/routers/share.py` — add helper `create_reviewer_share(...)` + endpoint
  `POST /assets/{asset_id}/reviewer-share`.
- `apps/api/schemas/share.py` — add `ReviewerShareCreate` and `ReviewerShareResponse` schemas.
- `apps/api/tests/test_reviewer_share.py` — new test file.

**Out of scope** (do NOT touch):
- The existing `create_share_link`, folder-share, and project-share endpoints — leave them
  exactly as they are. This plan *adds* a path, it does not change existing ones.
- `apps/web/**` — verify only (Step 4); do not modify unless the verification fails, in which
  case STOP and report rather than editing.
- Database migrations — this uses existing columns only; no schema change. If you find yourself
  needing a new column, STOP.

## Git workflow

- Branch: `advisor/002-reviewer-safe-share`
- Conventional-commit message, e.g. `feat(api): add reviewer-safe single-video share endpoint`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the reviewer-share schemas

In `apps/api/schemas/share.py`, after the existing `MultiShareCreate` class, add:

```python
class ReviewerShareCreate(BaseModel):
    """Locked-down inputs for a reviewer-safe single-asset share.

    Everything not listed here is forced to a safe default by the server:
    asset-scoped, versions hidden, public guest access, no folder/project exposure.
    """
    permission: SharePermission = SharePermission.comment  # view | comment | approve
    allow_download: bool = False
    expires_at: Optional[datetime] = None
    password: Optional[str] = None
    title: Optional[str] = None


class ReviewerShareResponse(BaseModel):
    token: str
    asset_id: uuid.UUID
    permission: SharePermission
    allow_download: bool
    url: str  # fully-formed public review URL: {frontend_url}/share/{token}
    expires_at: Optional[datetime] = None
```

`SharePermission`, `datetime`, `uuid`, `Optional`, and `BaseModel` are already imported at the
top of this file (confirm).

**Verify**: `python -c "from apps.api.schemas.share import ReviewerShareCreate, ReviewerShareResponse"` (from repo root, API deps installed) → exit 0.

### Step 2: Add the `create_reviewer_share` helper in the router

In `apps/api/routers/share.py`, add a module-level helper near the other `_`-prefixed helpers
(after `_get_latest_media_file`, before the `@router.post("/assets/{asset_id}/share"...)`
endpoint). This is the single blessed minting path; Plan 003 will import and call it.

```python
def create_reviewer_share(
    db: Session,
    asset: Asset,
    created_by: uuid.UUID,
    permission: SharePermission = SharePermission.comment,
    allow_download: bool = False,
    expires_at: Optional[datetime] = None,
    password: Optional[str] = None,
    title: Optional[str] = None,
) -> ShareLink:
    """Create a reviewer-safe, asset-scoped guest share link.

    Hard guarantees (a reviewer can NEVER see more than the one asset):
      - asset_id set; folder_id and project_id stay NULL
      - show_versions = False (no sibling versions)
      - visibility = "public" (guest, no account required)
      - allow_download defaults off
    """
    token = secrets.token_urlsafe(32)
    if password:
        pwd_bytes = password[:72].encode("utf-8")
        password_hash = bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")
        password_encrypted = encrypt_password(password)
    else:
        password_hash = None
        password_encrypted = None

    link = ShareLink(
        asset_id=asset.id,
        folder_id=None,
        project_id=None,
        token=token,
        created_by=created_by,
        title=title if title else asset.name,
        expires_at=expires_at,
        password_hash=password_hash,
        password_encrypted=password_encrypted,
        permission=permission,
        visibility="public",
        allow_download=allow_download,
        show_versions=False,
        show_watermark=False,
    )
    db.add(link)
    db.add(ActivityLog(user_id=created_by, asset_id=asset.id, action=ActivityAction.shared))
    db.commit()
    db.refresh(link)
    return link
```

Note: `appearance` is omitted so the model's server-default JSON applies. If the executor finds
that `ShareLink(...)` requires `appearance` (NOT NULL with no default at insert time), pass
`appearance={"layout": "grid", "theme": "dark", "accent_color": None, "open_in_viewer": True, "sort_by": "created_at"}` to match the column's `server_default`. Check `apps/api/models/share.py`
`appearance` column — it has a `server_default`, so omission should be fine; verify in Step 5
that inserts succeed.

**Verify**: `grep -n "def create_reviewer_share" apps/api/routers/share.py` → one match.

### Step 3: Add the editor-facing endpoint

Immediately after `create_share_link` (after its `return link`, ~line 210), add:

```python
@router.post(
    "/assets/{asset_id}/reviewer-share",
    response_model=ReviewerShareResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reviewer_share_endpoint(
    asset_id: uuid.UUID,
    body: ReviewerShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mint a reviewer-safe link to a SINGLE asset (the sent video only)."""
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    link = create_reviewer_share(
        db,
        asset=asset,
        created_by=current_user.id,
        permission=body.permission,
        allow_download=body.allow_download,
        expires_at=body.expires_at,
        password=body.password,
        title=body.title,
    )
    return ReviewerShareResponse(
        token=link.token,
        asset_id=asset.id,
        permission=link.permission,
        allow_download=link.allow_download,
        url=f"{settings.frontend_url.rstrip('/')}/share/{link.token}",
        expires_at=link.expires_at,
    )
```

Add the imports this needs at the top of `share.py` if not already present:
- `from ..config import settings` (for `frontend_url`)
- add `ReviewerShareCreate, ReviewerShareResponse` to the existing
  `from ..schemas.share import (...)` import list.

**Verify**: `grep -n "reviewer-share" apps/api/routers/share.py` → one match for the route.

### Step 4: Verify the web reviewer viewer needs no change

Confirm (read-only) that an asset-scoped share renders a single asset with no version switcher
or folder grid:

- `grep -nE "show_versions|FolderShareViewer|VersionSwitch" apps/web/app/share/[token]/page.tsx`
- Confirm `show_versions` is referenced only on the folder/project branch (around lines 978/995),
  and that when `asset_id` is set and `folder_id`/`project_id` are null, `ShareViewer` (single
  asset) is rendered.

If that holds, **make no web change**. If an asset-scoped share is found to render a version
switcher or any sibling/folder navigation, STOP and report — that is a separate web fix and
must not be bolted onto this API plan.

### Step 5: Tests

Create `apps/api/tests/test_reviewer_share.py`. Model its setup on
`apps/api/tests/test_share_session.py` (read it first for the exact fixture/client helpers).
Cover:

1. **Happy path**: editor POSTs `/assets/{asset_id}/reviewer-share` → 201; response `url` ends
   with `/share/{token}`; the created `ShareLink` row has `asset_id == asset_id`,
   `folder_id is None`, `project_id is None`, `show_versions is False`, `visibility == "public"`,
   `allow_download is False` (defaults).
2. **Permission default**: with empty body, `permission == comment`.
3. **Download opt-in**: body `{"allow_download": true}` → row `allow_download is True`.
4. **Authorization**: a user who is *not* an editor on the asset's project gets 403 (reuse the
   way `test_share_session.py` builds a non-member user; if that helper isn't obvious, assert the
   editor path only and note the gap).
5. **Reviewer cannot widen**: validate the minted token via `GET /share/{token}` and assert the
   response has `asset_id` set and `folder_id`/`project_id` null (the reviewer is confined to the
   one asset).

**Verify**: `python -m pytest apps/api/tests/test_reviewer_share.py -q` → all new tests pass.

### Step 6: Full suite

**Verify**: `python -m pytest apps/api/tests -q` → all pass (no regressions in existing share tests).

## Test plan

(Covered in Step 5.) New file `apps/api/tests/test_reviewer_share.py`, patterned on
`test_share_session.py`, asserting the five cases above. The load-bearing assertions are #1 and
#5 — they are the security guarantee that a reviewer link can never resolve to a folder or
project.

## Done criteria

ALL must hold:

- [ ] `python -m pytest apps/api/tests -q` exits 0; `test_reviewer_share.py` exists with ≥5 passing tests
- [ ] `grep -n "def create_reviewer_share" apps/api/routers/share.py` → match
- [ ] `grep -n "reviewer-share" apps/api/routers/share.py` → match
- [ ] A minted reviewer share row always has `folder_id IS NULL AND project_id IS NULL AND show_versions = false` (asserted by tests)
- [ ] No web files modified (`git -C /Users/neyako/freeframed status --porcelain` lists only the three in-scope files)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back if:

- `create_share_link` or `_get_asset` / `require_project_role` no longer exist or have a
  different signature (the router was refactored since `dfa0ab1`).
- Inserting a `ShareLink` without `appearance` fails AND the `server_default` workaround in
  Step 2 also fails — there is an unexpected NOT NULL constraint to investigate.
- The web verification in Step 4 reveals an asset-scoped share *does* leak versions/siblings.
- You cannot run `python -m pytest` in your environment (do not ship untested API code).

## Maintenance notes

- `create_reviewer_share` is the **single blessed minting path** for reviewer links. Plan 003's
  ingest endpoint imports it. Do not duplicate share-creation logic elsewhere; route it through
  this helper so the asset-scope/`show_versions=False` guarantee stays in one place.
- If a future feature wants reviewers to compare two specific versions, that is a deliberate
  widening and must be a new, explicitly-named share type — never loosen this helper's defaults.
- Reviewer should scrutinise: the helper hard-codes `folder_id=None, project_id=None`,
  `show_versions=False`, `visibility="public"` and does not read those from caller input.
- `frontend_url` must be set to the public review web origin in the API's `.env` for the returned
  `url` to be correct; note this in the deployment docs as a follow-up if not already documented.
