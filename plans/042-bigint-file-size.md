# Plan 042: Widen file_size_bytes columns to BigInteger so uploads over 2 GB work

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 39bdfc6..HEAD -- apps/api/models/asset.py apps/api/models/comment.py apps/api/alembic/versions/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

FreeFrame advertises a 10 GB upload limit (`MAX_FILE_SIZE_BYTES = 10 * 1024 *
1024 * 1024` in `apps/api/schemas/upload.py:15`), but the database columns that
store file sizes are plain PostgreSQL `INTEGER`, whose maximum is
2,147,483,647 (~2.14 GB). Any upload of a file larger than that inserts a
`MediaFile` row with an out-of-range value: Postgres raises
`NumericValueOutOfRange`, the request 500s, and the upload fails — for a video
review platform where multi-gigabyte masters are the normal case. The same
truncation trap exists on comment attachments. The fix is to widen two columns
to `BIGINT` via one Alembic migration plus the matching model changes.

## Current state

- `apps/api/models/asset.py` — SQLAlchemy models for assets/versions/files.
  The bug, at line 77:

  ```python
  file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
  ```

  (inside `class MediaFile`; `Integer` is imported at line 5:
  `from sqlalchemy import String, Enum, DateTime, ForeignKey, Integer, Float, func, UniqueConstraint, Index`)

- `apps/api/models/comment.py` — comment models. Same bug at line 49 inside
  `class CommentAttachment`:

  ```python
  file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
  ```

- `apps/api/alembic/versions/b4623f8f4339_initial.py` — initial migration;
  created both columns as `sa.Integer()` (lines 331 and 383). Do NOT edit
  this file — history migrations are immutable; you add a new migration.

- The current Alembic **head** is `8ca3dffea55f`
  (`8ca3dffea55f_add_share_link_items_table.py` — nothing has
  `down_revision = '8ca3dffea55f'`). Your new migration's `down_revision`
  must be `'8ca3dffea55f'`.

- Migration file conventions in this repo (see
  `apps/api/alembic/versions/c6d7e8f9a0b1_add_password_encrypted_column.py`
  for a minimal exemplar): module docstring with revision/date, typed
  `revision: str` / `down_revision`, `upgrade()` and `downgrade()` functions
  using `op.*`.

- Pydantic schemas already use unbounded Python `int`
  (`apps/api/schemas/upload.py`, `apps/api/schemas/comment.py:47,58`) — no
  schema change needed.

- The API tests (`apps/api/tests/`) run against a **mocked** DB session
  (`tests/conftest.py` builds `MagicMock` sessions), so no existing test
  touches these column types. Your new test asserts the SQLAlchemy table
  metadata directly — that works without any database.

- There is no local Python venv with the API deps on this machine. Static
  verification (`python3 -m py_compile`) works locally; `pytest` runs in CI
  (Python 3.12, `pip install -r apps/api/requirements.txt`). If you have a
  working environment with the requirements installed, run pytest locally too.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax check | `python3 -m py_compile apps/api/models/asset.py apps/api/models/comment.py apps/api/alembic/versions/<new file>.py` | exit 0, no output |
| API tests (CI, or locally if deps installed) | `python -m pytest apps/api/tests/ -v` | all pass, ≥40 passed |
| Grep gate | `grep -rn "file_size_bytes.*Integer" apps/api/models/` | no matches |

## Scope

**In scope** (the only files you should modify/create):
- `apps/api/models/asset.py` (edit line 77 + import)
- `apps/api/models/comment.py` (edit line 49 + import)
- `apps/api/alembic/versions/<new>_widen_file_size_to_bigint.py` (create)
- `apps/api/tests/test_model_column_types.py` (create)

**Out of scope** (do NOT touch, even though they look related):
- `apps/api/alembic/versions/b4623f8f4339_initial.py` — applied history;
  editing it desyncs existing deployments.
- `apps/api/schemas/upload.py` / `schemas/comment.py` — Python ints are
  already unbounded; changing `MAX_FILE_SIZE_BYTES` is a product decision,
  not this bug.
- `apps/web/**` — the frontend sends byte counts as JSON numbers; no change.
- Any other `Integer` column (e.g. `AssetVersion.version_number`,
  `MediaFile.width/height`) — those ranges are fine.

## Git workflow

- Branch: `advisor/042-bigint-file-size`
- Commit style: conventional commits, e.g.
  `fix(api): widen file_size_bytes to BIGINT (uploads >2GB 500'd)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Change the two model columns to BigInteger

In `apps/api/models/asset.py`: add `BigInteger` to the existing `sqlalchemy`
import on line 5, and change line 77 to:

```python
file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
```

In `apps/api/models/comment.py`: same — add `BigInteger` to the sqlalchemy
import, change line 49 to use `BigInteger`.

**Verify**: `python3 -m py_compile apps/api/models/asset.py apps/api/models/comment.py` → exit 0,
and `grep -rn "file_size_bytes.*Integer" apps/api/models/` → no matches
(note: `BigInteger` contains the substring `Integer`, so use
`grep -rn "mapped_column(Integer" apps/api/models/asset.py apps/api/models/comment.py` → no matches
as the precise gate).

### Step 2: Write the migration by hand

Create `apps/api/alembic/versions/aa11bb22cc33_widen_file_size_to_bigint.py`
(the revision id `aa11bb22cc33` is fine — Alembic ids are opaque strings; keep
it if you have no tool to generate one). Do NOT attempt
`alembic revision --autogenerate` — it needs a live database that is not
available in this environment. Content:

```python
"""widen file_size_bytes to bigint

Revision ID: aa11bb22cc33
Revises: 8ca3dffea55f
Create Date: 2026-07-02

Uploads advertise a 10 GB limit but these columns were INTEGER (max ~2.14 GB);
larger files failed with NumericValueOutOfRange.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'aa11bb22cc33'
down_revision: Union[str, Sequence[str], None] = '8ca3dffea55f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'media_files', 'file_size_bytes',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )
    op.alter_column(
        'comment_attachments', 'file_size_bytes',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Lossy if any row exceeds 2**31-1; acceptable for a dev rollback.
    op.alter_column(
        'comment_attachments', 'file_size_bytes',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
    op.alter_column(
        'media_files', 'file_size_bytes',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
```

**Verify**: `python3 -m py_compile apps/api/alembic/versions/aa11bb22cc33_widen_file_size_to_bigint.py` → exit 0,
and `grep -n "down_revision" apps/api/alembic/versions/aa11bb22cc33_widen_file_size_to_bigint.py` → shows `'8ca3dffea55f'`.

### Step 3: Add a metadata-level regression test

Create `apps/api/tests/test_model_column_types.py`. This asserts the mapped
column types without any database, so it runs under the repo's mock-based
test setup (model after the import style of `apps/api/tests/test_smoke.py`):

```python
"""Regression test for plan 042: file sizes must be BIGINT-capable.

Uploads allow up to 10 GB (schemas/upload.py MAX_FILE_SIZE_BYTES); INTEGER
columns overflow at ~2.14 GB.
"""
import sqlalchemy as sa

from apps.api.models.asset import MediaFile
from apps.api.models.comment import CommentAttachment
from apps.api.schemas.upload import MAX_FILE_SIZE_BYTES


def test_media_file_size_column_is_bigint():
    col = MediaFile.__table__.c.file_size_bytes
    assert isinstance(col.type, sa.BigInteger)


def test_comment_attachment_size_column_is_bigint():
    col = CommentAttachment.__table__.c.file_size_bytes
    assert isinstance(col.type, sa.BigInteger)


def test_declared_limit_exceeds_int32():
    # Documents why BIGINT is required: the advertised limit doesn't fit int32.
    assert MAX_FILE_SIZE_BYTES > 2**31 - 1
```

(Note: `sa.BigInteger` is a subclass check target; `isinstance` is correct —
SQLAlchemy instantiates the type on the column.)

**Verify**: `python3 -m py_compile apps/api/tests/test_model_column_types.py` → exit 0.
If a Python env with `apps/api/requirements.txt` installed is available:
`python -m pytest apps/api/tests/test_model_column_types.py -v` → 3 passed.
Otherwise CI runs it (the backend-test job runs the whole `apps/api/tests/` dir).

## Test plan

- New file `apps/api/tests/test_model_column_types.py` (Step 3): two
  column-type assertions + one limit-vs-int32 documentation assertion.
- Existing suite must stay green: `python -m pytest apps/api/tests/ -v`
  (in CI) → everything passes; this plan adds 3 tests and breaks none
  (the mock-DB fixtures never materialize column types).
- Live-migration verification is deliberately deferred to deploy time
  (`alembic upgrade head` inside the dev compose stack) — see Maintenance
  notes; plan 045's integration harness will exercise the migration chain
  end-to-end in CI once it lands.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "mapped_column(BigInteger" apps/api/models/asset.py apps/api/models/comment.py` → 2 matches total
- [ ] `grep -n "mapped_column(Integer" apps/api/models/asset.py` → matches only non-size columns (rating, version_number, width, height, sequence_order — NOT file_size_bytes)
- [ ] New migration file exists with `down_revision = '8ca3dffea55f'` (as verified in Step 2)
- [ ] `python3 -m py_compile` exits 0 on all touched .py files
- [ ] `apps/api/tests/test_model_column_types.py` exists with 3 tests
- [ ] CI backend-test job passes (or local pytest if env available)
- [ ] `git status` shows only the 4 in-scope files (+ `plans/README.md`) changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rn "down_revision.*8ca3dffea55f" apps/api/alembic/versions/` already
  matches an existing file — someone added a migration since planning; your
  `down_revision` must chain onto the **new** head instead. Report which file
  and stop for re-verification.
- The model excerpts at `models/asset.py:77` / `models/comment.py:49` don't
  match "Current state" (drift).
- You are tempted to run `alembic upgrade` or `alembic revision
  --autogenerate` locally — there is no database in this environment; that is
  not part of this plan.

## Maintenance notes

- **Deploy step**: existing installations get the widened columns on their
  next `alembic upgrade head` (the dev/prod compose stacks run migrations on
  boot via the API entrypoint). `ALTER COLUMN ... TYPE bigint` on these
  small-cardinality tables is metadata-fast in Postgres; no downtime concern.
- The downgrade path is lossy if rows above 2.14 GB exist — that's noted in
  the migration docstring and acceptable (downgrade would reintroduce the
  bug anyway).
- If anyone raises `MAX_FILE_SIZE_BYTES` in the future, no further schema
  change is needed (BIGINT max ≈ 9.2 EB).
- Reviewer focus: confirm the migration touches exactly the two tables and
  nothing else; confirm `b4623f8f4339_initial.py` is untouched.
- Related but deferred: `routers/integrations.py` streams ingest uploads
  through the API process synchronously — large-file behavior there is a
  separate concern, not a schema issue.
