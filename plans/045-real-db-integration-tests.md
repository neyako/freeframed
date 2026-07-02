# Plan 045: Real-Postgres integration test baseline for the API

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 39bdfc6..HEAD -- apps/api/tests/ .github/workflows/ci.yml pytest.ini apps/api/services/permissions.py`
> Plans 041 and 042 are EXPECTED to have changed `ci.yml` and models/tests —
> that is fine (this plan depends on them). For anything else that changed,
> compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED (touches CI; new infra)
- **Depends on**: plans/041-ci-repair-vitest-gate.md (both edit `ci.yml`), plans/042-bigint-file-size.md (one test here proves 042's migration live)
- **Category**: tests
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The entire API test suite runs against a `MagicMock` database session
(`apps/api/tests/conftest.py`) — `db.query(...)` returns the mock itself and
`first()` returns `None` unless a test overrides it. No SQL ever executes.
That means the things most likely to be wrong are exactly the things the
suite cannot catch: query bugs (missing `deleted_at` filters), schema bugs
(the INTEGER overflow fixed in plan 042), migration-chain breakage,
timezone-aware comparisons against Postgres `timestamptz`, and the RBAC
queries in `services/permissions.py` — the security core of the product.
Models use Postgres-specific `UUID`/`JSONB` types, so SQLite is not an
option; the baseline needs a real Postgres. This plan adds an opt-in
integration layer: tests that run only when `TEST_DATABASE_URL` is set,
a Postgres service container in CI so they always run there, and a first
batch of ~10 tests over the permission/share/version-numbering queries.
Every future fix to query-level behavior (e.g. plan 046's comment batching)
becomes honestly verifiable.

## Current state

- `apps/api/tests/conftest.py` — mock-based fixtures. Lines 15-25 set env
  vars (`DATABASE_URL`, `JWT_SECRET`, …) via `os.environ.setdefault` BEFORE
  app imports; `_make_mock_db()` (lines 61-73) builds the MagicMock session;
  `client` fixture (lines 82-94) patches S3 and overrides `get_db`.
  **This file stays untouched** — the mock suite keeps its job (fast
  routing/validation checks).
- `pytest.ini` (repo root) — entire current content:

  ```ini
  [pytest]
  testpaths = apps/api/tests
  python_files = test_*.py
  python_classes = Test*
  python_functions = test_*
  ```

- `apps/api/database.py` — `Base(DeclarativeBase)`, `SessionLocal`, engine
  built from `settings.database_url` at import time.
- `apps/api/alembic.ini` — `script_location = %(here)s/alembic`, so
  `alembic -c apps/api/alembic.ini upgrade head` works from the repo root.
  `alembic/env.py` reads the URL from `config.Settings()` → env
  `DATABASE_URL`, and puts `apps/api` on `sys.path` itself.
- Alembic head after plan 042: `aa11bb22cc33` (042's migration; chain
  `... → 8ca3dffea55f → aa11bb22cc33`).
- `.github/workflows/ci.yml` `backend-test` job: sets
  `DATABASE_URL: postgresql://user:pass@localhost:5432/freeframe_test` as an
  env var but has **no Postgres service** — the URL is only there so
  `Settings()` doesn't crash. (Post-041 the file also has the frontend
  vitest/tsc changes; they don't overlap with the backend-test job.)
- `apps/api/services/permissions.py` — the functions to test:
  `get_project_member` (14-19), `require_project_role` (22-46, rank map
  owner=4 > editor=3 > reviewer=2 > viewer=1, raises HTTPException 403),
  `can_access_asset` (60-83: creator → member → direct AssetShare → public
  project), `validate_share_link` (161-174: 404 unknown, 403 disabled,
  410 expired — compares `link.expires_at < datetime.now(timezone.utc)`),
  `validate_asset_in_share` (125-156: folder-descendant walk via
  `_is_descendant_of`, 113-122).
- `apps/api/routers/upload.py:64-68` — version numbering query
  (`last_version.version_number + 1`), the shape one integration test mirrors.
- Local Postgres options: the dev stack runs `postgres:15-alpine` with
  user/password/db `freeframe/freeframe/freeframe` on host port **5433**
  (`docker-compose.dev.yml:2-16`) — do NOT point tests at it (it may hold
  real data). Use a throwaway container instead (Step 5).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Throwaway Postgres (local) | `docker run -d --name ff-test-pg -p 5499:5432 -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=freeframe_test postgres:15-alpine` | container id printed |
| Run integration tests (local) | `TEST_DATABASE_URL=postgresql://user:pass@localhost:5499/freeframe_test python -m pytest apps/api/tests/integration/ -v` | all pass |
| Run mock suite unchanged | `python -m pytest apps/api/tests/ -v` (no TEST_DATABASE_URL) | all pass; integration tests reported as SKIPPED |
| Cleanup | `docker rm -f ff-test-pg` | container removed |
| Validate CI YAML | `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'ok'"` | `ok` |

Python deps: `pip install -r apps/api/requirements.txt` (pytest, SQLAlchemy,
alembic, psycopg2-binary are all in there). If no local Python env is
possible, Steps 1-4 are still writable; the local run in Step 5 is then
skipped and CI is the verification gate (STOP conditions cover the
distinction).

## Scope

**In scope** (the only files you should modify/create):
- `apps/api/tests/integration/__init__.py` (create, empty)
- `apps/api/tests/integration/conftest.py` (create)
- `apps/api/tests/integration/test_permissions_db.py` (create)
- `apps/api/tests/integration/test_share_links_db.py` (create)
- `apps/api/tests/integration/test_versions_db.py` (create)
- `pytest.ini` (register the `integration` marker)
- `.github/workflows/ci.yml` (backend-test job only: add service + env)

**Out of scope** (do NOT touch):
- `apps/api/tests/conftest.py` — the mock fixtures serve the existing 40+
  tests; replacing them is explicitly not this plan.
- Any file under `apps/api/` outside `tests/` — this plan adds tests, never
  "fixes" product code. If a test exposes a product bug, that is a STOP
  condition (report it — it becomes its own plan).
- The frontend-build / lint / docker-build jobs in `ci.yml` (041 owns
  frontend-build).
- `docker-compose.dev.yml` — the dev stack is not the test harness.

## Git workflow

- Branch: `advisor/045-integration-tests`
- Commit style: `test(api): add real-Postgres integration baseline` then
  `ci: run API integration tests against a postgres service`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Register the marker

Append to `pytest.ini`:

```ini
markers =
    integration: requires a real Postgres via TEST_DATABASE_URL
```

**Verify**: `grep -n "integration:" pytest.ini` → 1 match.

### Step 2: Integration conftest

Create `apps/api/tests/integration/__init__.py` (empty) and
`apps/api/tests/integration/conftest.py`:

```python
"""Real-Postgres integration fixtures.

Activated only when TEST_DATABASE_URL is set; otherwise every test in this
package is skipped. Schema comes from the real Alembic chain (upgrade head),
so these tests also verify migrations apply cleanly.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

TEST_DB_URL = os.getenv("TEST_DATABASE_URL")

# Make the app importable and satisfy Settings() before app imports, matching
# the pattern in apps/api/tests/conftest.py (which pytest loads first anyway,
# but don't rely on ordering).
os.environ.setdefault("DATABASE_URL", TEST_DB_URL or "postgresql://user:pass@localhost:5432/unused")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-key-for-tests-only")

REPO_ROOT = Path(__file__).resolve().parents[3]

pytestmark = pytest.mark.integration

def pytest_collection_modifyitems(config, items):
    if TEST_DB_URL:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL not set")
    for item in items:
        item.add_marker(skip)
        item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
def migrated_engine():
    """Run the real Alembic chain against the test DB, return an engine."""
    from sqlalchemy import create_engine

    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(REPO_ROOT / "apps/api/alembic.ini"), "upgrade", "head"],
        check=True,
        env={**os.environ, "DATABASE_URL": TEST_DB_URL},
        cwd=REPO_ROOT,
    )
    engine = create_engine(TEST_DB_URL)
    yield engine
    engine.dispose()


@pytest.fixture()
def db(migrated_engine):
    """Function-scoped real session; truncates all tables afterwards."""
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker
    from apps.api.database import Base

    Session = sessionmaker(bind=migrated_engine)
    session = Session()
    yield session
    session.rollback()
    session.close()
    tables = ", ".join(
        f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables)
    )
    with migrated_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture()
def make_user(db):
    import uuid
    from apps.api.models.user import User, UserStatus

    def _make(email=None, name="Test User"):
        u = User(
            email=email or f"{uuid.uuid4().hex[:8]}@example.com",
            name=name,
            status=UserStatus.active,
            email_verified=True,
        )
        db.add(u)
        db.flush()
        return u

    return _make


@pytest.fixture()
def make_project(db, make_user):
    from apps.api.models.project import Project

    def _make(owner=None, is_public=False):
        owner = owner or make_user()
        p = Project(name="Proj", created_by=owner.id, is_public=is_public)
        db.add(p)
        db.flush()
        return p, owner

    return _make
```

Notes for the executor:
- The `pytest_collection_modifyitems` hook makes the whole package skip
  cleanly when `TEST_DATABASE_URL` is unset — the mock suite's behavior and
  count stay untouched.
- Check `apps/api/models/project.py` for `Project`'s actual required columns
  before finalizing `make_project` (verified fields at planning time:
  `name`, `created_by`; `is_public` exists via migration `a2b3c4d5e6f7`). If
  the model requires more non-nullable fields, add them minimally.

**Verify**: `python3 -m py_compile apps/api/tests/integration/conftest.py` → exit 0.

### Step 3: The first test batch

Create three test files. Model assertions on the REAL functions — import
from `apps.api.services.permissions` and `apps.api.models.*`. Cases:

`test_permissions_db.py` (~6 tests):
1. `require_project_role`: owner passes `minimum_role=editor`; viewer raises
   `HTTPException` with `status_code == 403` for `minimum_role=editor`
   (build `ProjectMember` rows with real enums).
2. `require_project_role`: soft-deleted membership (`deleted_at` set) →
   403 "Not a project member" (proves the `deleted_at` filter executes).
3. `can_access_asset`: asset creator → True.
4. `can_access_asset`: unrelated user, private project → False.
5. `can_access_asset`: unrelated user + `AssetShare(shared_with_user_id=…)`
   → True; after setting `deleted_at` on the share → False.
6. `can_access_asset`: unrelated user, `is_public=True` project → True.

`test_share_links_db.py` (~4 tests):
1. `validate_share_link` happy path returns the link.
2. Expired link (`expires_at = now(timezone.utc) - timedelta(hours=1)`) →
   HTTPException 410. (Round-trips a timezone-aware datetime through
   Postgres `timestamptz` — exactly what mocks can't check.)
3. Disabled link (`is_enabled=False`) → 403.
4. `validate_asset_in_share` folder-share: asset in a **grandchild** folder
   of the shared folder passes (`_is_descendant_of` walks real parent
   chains); asset in a sibling folder raises 403.

`test_versions_db.py` (~2 tests):
1. Version numbering: create an asset with versions 1 and 2 (version 2
   soft-deleted), run the query shape from `routers/upload.py:64-68` —
   the next number must be 2 (deleted versions don't burn numbers... 
   **careful**: the real code filters `deleted_at.is_(None)`, so with v1
   live and v2 deleted, `last_version` is v1 → next is 2. Assert exactly
   that, mirroring the router's query verbatim.)
2. BigInteger regression (proves plan 042 end-to-end): insert a `MediaFile`
   with `file_size_bytes = 5 * 1024**3` (5 GB), `db.flush()`, read it back,
   assert equality. On a pre-042 schema this raises `DataError`.

Build rows with the real models (`Asset` needs `project_id`, `name`,
`asset_type=AssetType.video`, `created_by`; `AssetVersion` needs `asset_id`,
`version_number`, `created_by`; `MediaFile` needs `version_id`,
`file_type=FileType.video`, `original_filename`, `mime_type`,
`file_size_bytes`, `s3_key_raw` — all verified against
`apps/api/models/asset.py`).

**Verify**: `python3 -m py_compile apps/api/tests/integration/test_*.py` → exit 0.

### Step 4: CI wiring

In `.github/workflows/ci.yml`, `backend-test` job only:

1. Add a service block (directly under `runs-on`):

```yaml
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: user
          POSTGRES_PASSWORD: pass
          POSTGRES_DB: freeframe_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
```

2. Add to the job's existing `env:` block:

```yaml
      TEST_DATABASE_URL: postgresql://user:pass@localhost:5432/freeframe_test
```

(The existing `DATABASE_URL` env already points at the same URL — leave it.)

3. Update the "Run tests" step's minimum-passed tripwire from 40 to 50
   (the suite gains ~12 always-running-in-CI tests; keep the tripwire honest).

**Verify**: `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'ok'"` → `ok`;
`grep -n "TEST_DATABASE_URL" .github/workflows/ci.yml` → 1 match;
`grep -n "postgres:15-alpine" .github/workflows/ci.yml` → 1 match.

### Step 5: Run both modes locally (skip if no Python env — CI covers it)

```bash
docker run -d --name ff-test-pg -p 5499:5432 -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=freeframe_test postgres:15-alpine
sleep 3
TEST_DATABASE_URL=postgresql://user:pass@localhost:5499/freeframe_test \
  python -m pytest apps/api/tests/integration/ -v
python -m pytest apps/api/tests/ -v   # without the env var
docker rm -f ff-test-pg
```

**Verify**: first pytest → ~12 passed, 0 failed; second → all previous tests
pass and the integration package shows `SKIPPED` entries; container removed.

## Test plan

The plan IS the test plan: ~12 new integration tests (Step 3) + the skip
behavior (Step 5 second run). Structural pattern: plain pytest functions like
the existing `apps/api/tests/test_smoke.py`, but using the `db`/`make_user`/
`make_project` fixtures instead of mocks.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `apps/api/tests/integration/` exists with conftest + 3 test files
- [ ] `grep -n "integration:" pytest.ini` → 1 match
- [ ] CI: postgres service + `TEST_DATABASE_URL` present in backend-test job; YAML valid
- [ ] With a throwaway Postgres: integration suite passes (locally or in CI)
- [ ] Without `TEST_DATABASE_URL`: `python -m pytest apps/api/tests/ -v` → prior tests all pass, integration tests SKIPPED (count unchanged otherwise)
- [ ] No product code modified (`git status` — only the 7 in-scope files + `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 042's migration (`aa11bb22cc33`) is NOT in
  `apps/api/alembic/versions/` — the 5 GB test (Step 3) would fail against
  the old schema. Execute 042 first.
- `alembic upgrade head` fails against a fresh database — the migration
  chain itself is broken; that is a new P1 finding, not something to patch
  inline here.
- Any integration test fails because the **product code** behaves
  differently than the plan asserts (e.g. a soft-delete filter genuinely
  missing) — do not "fix" the product code; report the failing assertion,
  the observed behavior, and the file:line of the suspect query.
- The `backend-test` job in `ci.yml` doesn't match the post-041 shape
  described in Current state.

## Maintenance notes

- This harness is the prerequisite for honestly verifying plan 046 (comment
  batching) and any future query-level change; add an integration test
  whenever a bug class is "SQL the mocks can't see".
- Truncate-per-test is O(tables) and fine at this scale; if the suite grows
  past ~100 integration tests, switch to transaction-rollback-per-test
  (bind the session to an outer transaction and roll it back).
- The session-scoped `migrated_engine` runs the FULL migration chain once
  per run — it doubles as a migration smoke test; if someone squashes
  migrations, this fixture is where breakage shows first.
- Reviewer focus: no product files in the diff; the CI tripwire bump (40→50)
  matches the new always-on test count.
