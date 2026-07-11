# Task 11 report: prevent folder cycles and bound hierarchy traversal

## Status

PASS under the session-approved exact-inventory partition proof. Todo 11 is implemented and verified. The literal monolithic API command did not pass and is structurally incompatible with migration tests that require isolated database states; this is disclosed rather than relabeled. Product scope stayed limited to `apps/api/routers/folders.py` and `apps/api/services/permissions.py`.

## Clean start

Commands:

```text
rtk git rev-parse HEAD
rtk proxy git status --short
```

Receipt: `5aace3feafb5f73201165be450f2763a8c39a260`; short status empty.

## Unchanged baseline

Commands followed the brief exactly, with the local test DSN omitted from this report.

```text
PYTHONPYCACHEPREFIX=/private/tmp/ff078-task11-pycache rtk python3 -m py_compile apps/api/routers/folders.py apps/api/services/permissions.py apps/api/schemas/folder.py apps/api/models/folder.py
TEST_DATABASE_URL=[REDACTED_LOCAL_DSN] PYTHONPYCACHEPREFIX=/private/tmp/ff078-task11-pycache rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/integration/test_permission_matrix_db.py apps/api/tests/integration/test_share_links_db.py -v
```

Result: compile exit 0; compatibility baseline `14 passed in 1.60s`.

## Passing characterization before product edits

- Helper BFS/depth and normal permission ancestry: `2 passed`.
- Real-PostgreSQL PATCH, asset-only bulk, sibling folder+asset bulk, and invalid target/object committed-state cases: `9 passed`.
- Tests-only diff gate listed only:
  - `apps/api/tests/test_folder_hierarchy.py`
  - `apps/api/tests/integration/test_folder_hierarchy_db.py`

## RED evidence

Initial helper command:

```text
PYTHONPYCACHEPREFIX=/private/tmp/ff078-task11-pycache rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/test_folder_hierarchy.py -v
```

Result: `10 failed, 2 passed`. Eight traversal cases exhausted the two-unique-query budget and raised the test sentinel before any bounded 409; two permission-cycle cases silently returned false.

Initial real-PostgreSQL command:

```text
TEST_DATABASE_URL=[REDACTED_LOCAL_DSN] PYTHONPYCACHEPREFIX=/private/tmp/ff078-task11-pycache rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/integration/test_folder_hierarchy_db.py -v
```

Result: `7 failed, 11 passed`.

- `test_bulk_parent_to_child_rejects_without_writes`: vulnerable route committed the cycle.
- `test_bulk_child_to_ancestor_and_existing_parent_succeed[ancestor]`: reversed traversal returned 400.
- `test_bulk_child_to_ancestor_and_existing_parent_succeed[existing_parent]`: reversed traversal returned 400.
- `test_bulk_rejects_resulting_depth_eleven[False]`: depth-11 leaf committed.
- `test_bulk_rejects_resulting_depth_eleven[True]`: depth-11 subtree committed.
- `test_opposite_hierarchy_moves_serialize[False]`: bulk/bulk returned `[200, 200]`.
- `test_opposite_hierarchy_moves_serialize[True]`: PATCH/bulk returned `[200, 200]`.

Additional valid RED:

- Deleted two-node restore cycle succeeded after mutating the parent fallback before traversal; the new test failed until traversal moved before mutation.
- Live HTTP found corrupt-source PATCH-to-root returned 200 because null-target moves skipped source traversal. A real-PostgreSQL regression was added and observed failing before the minimal fix.
- The first characterization attempt also exposed the validate-before-mutate hazard by showing the valid asset ORM attribute dirtied before an invalid folder rejected; the final regression uses `no_autoflush` and asserts both ORM histories stay unchanged.

## Implementation

- Converted active and restore subtree traversals to `deque`/`popleft()` with repeat checks before SQL.
- Added exact 409 cycle handling to upward depth and permission ancestry walks.
- Added one active-project `SELECT ... FOR UPDATE` mutex and applied it before graph snapshots/mutations in create, parent PATCH, delete, bulk move, and restore.
- Reordered PATCH validation so corrupt source/target/subtree state is rejected before name/parent mutation, including root moves.
- Rebuilt bulk move as target/object loading, full cycle/depth validation, nested-selected-root topology calculation, then one assignment block and one commit.
- Moved restore traversal before parent fallback and restore mutations.
- Preserved active/deleted filters, timezone-aware delete timestamps, response counts, ordinary 400 details, and the recursive permission CTE.

## GREEN and concurrency evidence

Helper result after implementation: `12 passed`.

Focused command, run twice after the final product change:

```text
TEST_DATABASE_URL=[REDACTED_LOCAL_DSN] PYTHONPYCACHEPREFIX=/private/tmp/ff078-task11-pycache rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/integration/test_folder_hierarchy_db.py apps/api/tests/integration/test_permission_matrix_db.py apps/api/tests/integration/test_share_links_db.py -v
```

Results: `34 passed in 1.51s`; `34 passed in 1.57s`.

The SQLAlchemy hook observed the project `FOR UPDATE` before vulnerable traversal. Bulk/bulk and PATCH/bulk workers both stopped within the 20-second bound and produced `[200, 400]`; final SQL walks were acyclic.

## Complete API inventory proof

Discovered inventory after review fixes: 47 `test_*.py` files = 21 unit files + 26 integration files. Final ordered partitions execute every file once with zero missing, duplicate, failed, or skipped files:

| Partition | Files | Result |
| --- | ---: | ---: |
| Auth unit file on clean Redis DB 12 | 1 | 21 passed |
| Rate-limit unit file | 1 | 12 passed |
| Remaining unit files | 19 | 136 passed |
| Regular integration files on fresh task11 DB | 24 | 270 passed |
| Quick-share migration file on isolated DB | 1 | 7 passed |
| Durable-processing migration file on exact isolated task3 DB/port | 1 | 23 passed |
| Total | 47 | 469 passed |

The literal monolithic command was attempted and did not pass. It first stopped at the deliberate Task 3 exact-database guard. Running all remaining integration tests in one shared schema allowed migration suites to downgrade that schema and produced missing-column failures. The session-approved replacement is the ordered isolated partition proof above. Machine-readable commands, explicit file lists, counts, arithmetic, zero missing/duplicate/skipped lists, and sorted-path hashes are in `.omo/evidence/078/task-11/inventory.json`. The receipt file list exactly matches discovery with SHA-256 `6ecf6479ad22694ce32db307e7583ccbc1790b77413330f22d01d54a036f7aa4`.

Compile and diff checks:

```text
PYTHONPYCACHEPREFIX=/private/tmp/ff078-task11-pycache rtk python3 -m py_compile apps/api/routers/folders.py apps/api/services/permissions.py apps/api/tests/test_folder_hierarchy.py apps/api/tests/integration/test_folder_hierarchy_db.py
rtk git diff --check
```

Result: both exit 0.

## Live HTTP and SQL QA

Alembic head was applied to a fresh task11 database. A synthetic superadmin/project/tree/assets/token fixture was written to a mode `0600` runtime file. Uvicorn used the real app and routes on `127.0.0.1:18011`; `--lifespan off` was required only because Docker/MinIO was intentionally absent and folder routes do not use S3.

The standard-library HTTP driver used five-second request timeouts and PostgreSQL receipts after denied calls. Result: PASS.

- parent -> child: 400, parent row unchanged;
- sibling folder plus two assets: 200, counts 1/2;
- child -> ancestor: 200;
- existing-parent no-op: 200;
- resulting depth 10: 200, maximum depth 10;
- resulting depth 11: 400, row unchanged, maximum depth remains 10;
- corrupt PATCH/bulk/delete: exact 409/detail, rows unchanged;
- simultaneous opposite bulk moves: `[200, 400]`, acyclic, maximum depth 2.

Redacted evidence: `.omo/evidence/078/task-11/folders.json`.

## Evidence redaction scan

Scanned evidence/report for bearer/JWT/auth headers, cookies, emails, names, passwords, DSNs, S3 keys, presigned URLs, runtime UUIDs, and synthetic secret values. Evidence contains only stable labels, public statuses/detail, counts, booleans, depths, elapsed milliseconds, and PASS.

## Cleanup receipt

- Uvicorn stopped; curl to `127.0.0.1:18011` returned connection refused.
- Task11 PostgreSQL stopped; `pg_isready` on 55441 reported `no response`.
- Isolated Task3 PostgreSQL stopped; `pg_isready` on 55433 reported `no response`.
- Removed both pgdata directories/logs, pycache, pytest cache, seed/live driver scripts, runtime JSON, and transient files.
- Preserved only declared source, tests, evidence, and report artifacts.

## Changed files

- `apps/api/routers/folders.py`
- `apps/api/services/permissions.py`
- `apps/api/tests/test_folder_hierarchy.py`
- `apps/api/tests/integration/_folder_hierarchy_support.py`
- `apps/api/tests/integration/test_folder_hierarchy_db.py`
- `apps/api/tests/integration/test_folder_hierarchy_matrix_db.py`
- `apps/api/tests/integration/test_folder_hierarchy_corruption_db.py`
- `apps/api/tests/integration/test_folder_hierarchy_concurrency_db.py`
- `.omo/evidence/078/task-11/folders.json`
- `.omo/evidence/078/task-11/inventory.json`
- `.omo/evidence/078/task-11/worktree-status.txt`
- `.superpowers/sdd/task-11-report.md`

## Self-review

- Direction confusion, self/no-op, partial batch, exact depth boundary, nested selection calculation, corrupt active/deleted traversal, soft-delete/cross-project rejection, concurrency/cross-path serialization, deadlock bounds, query budget, deque traversal, SQL truth checks, dirty-worktree scope, and secret-evidence constraints are covered.
- No migration, model, schema, frontend, `share.py`, comments router, pagination, or unrelated file changed.
- Every changed/new Python test or helper remains below 250 pure LOC: `108`, `62`, `169`, `126`, `85`, and `143`.
- No `Any`, `cast`, type-ignore, broad exception, `list.pop(0)`, naive datetime, partial commit, or caller-ordered folder lock was added.

## Concerns

- The repo's migration tests intentionally require isolated database states, so the literal one-process full-suite command is not a valid green gate. Complete ordered inventory proof is green as documented.
- Live app startup required disabling lifespan because MinIO was intentionally unavailable; all requested folder HTTP routes and PostgreSQL state were exercised through the real ASGI server.

## Independent review fixes

Review base: `998a8ec98f1a0e9db3ffe50761b59286d29bbbe0`; worktree clean before review-fix tests.

### Review RED

Tests-only paths were created/split before product edits. Unit RED:

```text
PYTHONPYCACHEPREFIX=[TEMP] rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/test_folder_hierarchy.py -v
```

Result: `2 failed, 12 passed`. Self-cycle and two-node cycle both returned success when the requested ancestor was observed before the repeat.

Real-PostgreSQL RED:

```text
TEST_DATABASE_URL=[REDACTED_LOCAL_DSN] PYTHONPYCACHEPREFIX=[TEMP] rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/integration/test_folder_hierarchy_db.py apps/api/tests/integration/test_folder_hierarchy_matrix_db.py apps/api/tests/integration/test_folder_hierarchy_corruption_db.py apps/api/tests/integration/test_folder_hierarchy_concurrency_db.py -v
```

Result: `5 failed, 30 passed`.

- Permission service self-cycle returned success instead of 409.
- Permission service two-node cycle returned success instead of 409.
- Real permission route returned success instead of 409 for a two-node corrupt ancestry containing the requested ancestor.
- Waiting parent PATCH returned 200 after the delete winner committed instead of refetching the now-deleted source and returning 404.
- Waiting second restore returned 200 after the first restore committed instead of refetching the now-active source and returning 404.

### Review implementation

- `_is_descendant_of` now records whether the ancestor was observed, continues until an acyclic terminus, raises exact 409 on any repeat, and returns the recorded result only after termination.
- Parent PATCH and delete refetch the source with `deleted_at IS NULL` immediately after acquiring the active-project mutex.
- Restore refetches the source with `deleted_at IS NOT NULL` immediately after acquiring the mutex.
- Integration coverage was split into a non-collected support module plus cohesive base, matrix, corruption, and concurrency modules; no test functions are imported.
- Added PostgreSQL proof for bulk-to-root, depth 10, nested roots, deleted target, deleted/cross-project assets, corrupt bulk/delete/permission, both mixed-invalid SQL orders, asserted project-lock observation, and final acyclic/max-depth truth for both opposite-move variants.

### Review GREEN

Exact affected command, run twice:

```text
TEST_DATABASE_URL=[REDACTED_LOCAL_DSN] PYTHONPYCACHEPREFIX=[TEMP] rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/test_folder_hierarchy.py apps/api/tests/integration/test_folder_hierarchy_db.py apps/api/tests/integration/test_folder_hierarchy_matrix_db.py apps/api/tests/integration/test_folder_hierarchy_corruption_db.py apps/api/tests/integration/test_folder_hierarchy_concurrency_db.py apps/api/tests/integration/test_permission_matrix_db.py apps/api/tests/integration/test_share_links_db.py -v
```

Results: `63 passed in 2.01s`; `63 passed in 2.05s`.

Complete accepted inventory proof: `469 passed`, `0 failed`, `0 skipped`, 47 unique files, no missing or duplicate file. See `inventory.json` for exact partition commands and file arrays.

### Review live HTTP/SQL QA

- Public permission route on a two-node corrupt hierarchy: exact 409/detail; both parent rows unchanged.
- Project row locked first; HTTP PATCH loaded source and waited; SQL delete winner committed; waiter returned 404; final row stayed under its original parent and was deleted.
- Project row locked first; HTTP restore loaded deleted source and waited; SQL restore winner committed; waiter returned 404; final row stayed under its original parent and was active.
- Lock-wait detection used PostgreSQL ungranted-lock state, not timing sleeps as proof.

### Review cleanup and checks

- Uvicorn 18011, PostgreSQL 55441, and isolated PostgreSQL 55433 all refuse connections after shutdown.
- Removed review seed/driver/runtime files, both pgdata directories/logs, pycache, and pytest cache.
- Changed Python compile passed; `git diff --check` passed; no `pop(0)`, `Any`, `cast`, type-ignore, or broad exception was introduced.
