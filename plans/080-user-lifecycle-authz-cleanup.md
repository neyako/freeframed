# Plan 080: Revoke access grants on user deletion and validate user ids at grant points

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 96b6644..HEAD -- apps/api/routers/users.py apps/api/routers/projects.py apps/api/routers/assets.py apps/api/routers/folders.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `96b6644`, 2026-07-12

## Why this matters

Deleting a user (`DELETE /users/{user_id}`) only revokes refresh tokens and sets
`User.deleted_at`. Their `ProjectMember` rows and `AssetShare` grants stay live.
Nothing honors `User.deleted_at` when evaluating those rows — and
`POST /users/invite` deliberately *resurrects* a soft-deleted user with the
**same user id** (the unique email constraint forces this). Net effect: removing
a user does not revoke their access; re-inviting the same email silently
restores every project membership and direct share they ever had, with no
project-owner review. Two adjacent gaps compound this: `add_project_member` and
`update_assignment` accept a raw `user_id` with no existence/active check (a
nonexistent id → 500 `IntegrityError`; a soft-deleted id is silently accepted),
and `move_asset` skips the project row lock every sibling mutation takes.

## Current state

Files:

- `apps/api/routers/users.py` — `delete_user` (lines ~143–149) and
  `invite_user` resurrection branch (lines ~55–75). No `ProjectMember` or
  `AssetShare` reference anywhere in this file.
- `apps/api/routers/projects.py` — `add_project_member` (lines ~373–390)
  creates the membership before ever querying `User`; `delete_project`
  (lines ~294–353) is the repo's exemplar soft-delete cascade.
- `apps/api/routers/assets.py` — `update_assignment` (lines ~378–397) sets
  `asset.assignee_id = body.assignee_id` with no user lookup.
- `apps/api/routers/folders.py` — `move_asset` (lines ~452–472) mutates
  `asset.folder_id` without `_lock_active_project` (defined at line ~237;
  used by `update_folder`:393, `delete_folder`:431, `bulk_move`:483,
  `restore_folder`:639).
- `apps/api/routers/share.py` — `_resolve_active_share_recipient`
  (lines ~125–137) is the existing "resolve an active user or 404" exemplar.

`delete_user` today (`users.py:143-149`):

```python
@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    revoke_user_refresh_tokens(db, user.id)
    user.deleted_at = datetime.now(timezone.utc)
    db.commit()
```

The cascade pattern to copy — `delete_project` (`projects.py:294-353`, excerpt):

```python
    now = datetime.now(timezone.utc)
    project.deleted_at = now
    db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
```

Relevant model columns (both soft-deletable):

- `ProjectMember` (`apps/api/models/project.py:44-53`): `project_id`,
  `user_id`, `role`, `deleted_at`.
- `AssetShare` (`apps/api/models/share.py:75-92`): `asset_id`/`folder_id`
  (exactly one set), `shared_with_user_id` (nullable), `shared_by`,
  `deleted_at`.

The active-user resolver exemplar (`share.py:125-137`):

```python
def _resolve_active_share_recipient(db: Session, body: DirectShareCreate) -> User:
    filters = [User.deleted_at.is_(None)]
    if body.user_id is not None:
        filters.append(User.id == body.user_id)
    ...
    recipient = db.query(User).filter(*filters).first()
    if recipient is None:
        raise HTTPException(status_code=404, detail="User not found")
    return recipient
```

Conventions that apply:

- Soft delete everywhere: mark rows with `deleted_at = datetime.now(timezone.utc)`,
  never hard-delete. Always timezone-aware datetimes.
- Bulk soft-delete uses `.update({"deleted_at": now}, synchronize_session="fetch")`
  exactly as in `delete_project`.
- Real-Postgres integration tests live in `apps/api/tests/integration/`
  (files named `test_*_db.py`, fixtures in `conftest.py` there; they
  auto-skip when `TEST_DATABASE_URL` is unset). Model new tests on
  `apps/api/tests/integration/test_permissions_db.py`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax check | `python3 -m py_compile apps/api/routers/users.py apps/api/routers/projects.py apps/api/routers/assets.py apps/api/routers/folders.py` | exit 0, no output |
| API unit tests (mock DB) | `python -m pytest apps/api/tests/ -v -k "not integration"` | all pass (needs `pip install -r apps/api/requirements-dev.txt`; if no local env, CI is the gate — say so in your report) |
| Integration tests | `TEST_DATABASE_URL=postgresql://... python -m pytest apps/api/tests/integration/ -v` | all pass incl. new tests (skips without the env var — that's expected locally) |

There is no Python venv on the maintainer's machine — CI is the authoritative
gate. At minimum run `py_compile` locally and write the tests so CI exercises
them.

## Scope

**In scope** (the only files you should modify):

- `apps/api/routers/users.py`
- `apps/api/routers/projects.py` (only `add_project_member`)
- `apps/api/routers/assets.py` (only `update_assignment`)
- `apps/api/routers/folders.py` (only `move_asset`)
- `apps/api/tests/integration/test_user_lifecycle_db.py` (create)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):

- `apps/api/routers/share.py` — its direct-share path already validates
  recipients; plan 082 touches this file concurrently.
- The `invite_user` resurrection mechanism itself — resurrection is correct
  (unique email constraint); the fix is revoking grants at delete time, not
  changing resurrection.
- `reactivate_user` (`users.py:132-140`) — reactivating a *suspended* (not
  deleted) user should keep memberships; leave it alone.
- Any schema/migration change — none is needed; all columns exist.

## Git workflow

- Branch: `advisor/080-user-lifecycle-authz`
- Conventional commits, e.g. `fix(users): revoke memberships and shares on user deletion`
- Do NOT push or merge; the maintainer merges.

## Steps

### Step 1: Cascade grant revocation in `delete_user`

In `apps/api/routers/users.py`, inside `delete_user`, after
`revoke_user_refresh_tokens(db, user.id)` and before `db.commit()`, soft-delete
the user's grants using the `delete_project` bulk pattern:

```python
now = datetime.now(timezone.utc)
user.deleted_at = now
db.query(ProjectMember).filter(
    ProjectMember.user_id == user.id,
    ProjectMember.deleted_at.is_(None),
).update({"deleted_at": now}, synchronize_session="fetch")
db.query(AssetShare).filter(
    AssetShare.shared_with_user_id == user.id,
    AssetShare.deleted_at.is_(None),
).update({"deleted_at": now}, synchronize_session="fetch")
```

Add the imports (`ProjectMember` from `..models.project`, `AssetShare` from
`..models.share`) matching the import style at the top of the file.

**Verify**: `python3 -m py_compile apps/api/routers/users.py` → exit 0, and
`grep -c "ProjectMember\|AssetShare" apps/api/routers/users.py` → ≥ 4 matches.

### Step 2: Validate the user in `add_project_member`

In `apps/api/routers/projects.py`, at the top of `add_project_member` (after
`_require_project_owner`), resolve the target user before any membership
query, mirroring `_resolve_active_share_recipient`:

```python
target_user = db.query(User).filter(
    User.id == body.user_id, User.deleted_at.is_(None)
).first()
if target_user is None:
    raise HTTPException(status_code=404, detail="User not found")
```

Then replace the later `added_user = db.query(User)...` lookup with
`target_user` (it is now guaranteed present, so the `if added_user:` guard can
use `target_user` directly).

**Verify**: `python3 -m py_compile apps/api/routers/projects.py` → exit 0.

### Step 3: Validate the assignee in `update_assignment`

In `apps/api/routers/assets.py`, inside `update_assignment`, before applying
`body.assignee_id`, add:

```python
if "assignee_id" in body.model_fields_set and body.assignee_id is not None:
    assignee = db.query(User).filter(
        User.id == body.assignee_id, User.deleted_at.is_(None)
    ).first()
    if assignee is None:
        raise HTTPException(status_code=404, detail="User not found")
```

Keep clearing the assignment (`assignee_id = None`) working unchanged. Check
whether `User` is already imported in this file; add the import if not.

**Verify**: `python3 -m py_compile apps/api/routers/assets.py` → exit 0.

### Step 4: Take the project lock in `move_asset`

In `apps/api/routers/folders.py`, inside `move_asset`, immediately after the
`require_project_role(...)` call, add:

```python
_lock_active_project(db, asset.project_id)
```

(`_lock_active_project` is defined in the same file at ~line 237 — no import
needed.)

**Verify**: `grep -n "_lock_active_project" apps/api/routers/folders.py` now
shows a match inside `move_asset` (6 call sites total, was 5).

### Step 5: Integration tests

Create `apps/api/tests/integration/test_user_lifecycle_db.py`, modeled
structurally on `apps/api/tests/integration/test_permissions_db.py` (same
fixture usage from that directory's `conftest.py`). Cover:

1. **Grant revocation**: create user B, add as `ProjectMember` to a project and
   give an `AssetShare` (`shared_with_user_id=B`); call the delete-user flow
   (or replicate its mutation directly against the session if the tests drive
   routers via TestClient — follow whichever style `test_permissions_db.py`
   uses); assert both rows now have `deleted_at IS NOT NULL`.
2. **Resurrection is clean**: after deletion, re-invite the same email; assert
   the resurrected user id equals the old id AND has zero live
   `ProjectMember`/`AssetShare` rows.
3. **add_project_member rejects bad ids**: a random UUID → 404 (not 500); a
   soft-deleted user's id → 404.
4. **update_assignment rejects bad ids**: soft-deleted user id → 404; clearing
   assignment with `assignee_id: null` still succeeds.

**Verify**: with a `TEST_DATABASE_URL` available:
`python -m pytest apps/api/tests/integration/test_user_lifecycle_db.py -v` →
all pass. Without one: the file collects and auto-skips
(`python -m pytest apps/api/tests/integration/test_user_lifecycle_db.py -v`
→ skipped, not errored).

## Test plan

Covered by Step 5 (4 integration test cases). No web changes, no unit-test
changes needed; do not reduce any existing test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `python3 -m py_compile` exits 0 on all four routers
- [ ] `grep -n "AssetShare" apps/api/routers/users.py` → ≥1 match
- [ ] `grep -n "_lock_active_project" apps/api/routers/folders.py` → 6 call sites (+ the def)
- [ ] `apps/api/tests/integration/test_user_lifecycle_db.py` exists with ≥4 tests
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift since `96b6644`).
- You find an existing mechanism that already revokes grants on user delete
  (search first: `grep -rn "shared_with_user_id" apps/api/routers/users.py
  apps/api/services/` should be empty before you start).
- The integration-test conftest fixtures don't support creating users/members
  directly and you'd need to modify `conftest.py` — report instead of editing it.
- Any existing test starts failing for reasons unrelated to your diff.

## Maintenance notes

- If a "transfer ownership on user delete" feature ever lands, this cascade is
  the place it hooks in — projects owned solely by the deleted user currently
  keep `created_by` pointing at the deleted user (pre-existing, unchanged here).
- Reviewer should scrutinize: the `AssetShare` filter uses
  `shared_with_user_id` (grants TO the user). Grants *created by* the user
  (`shared_by`) stay — that's intentional; they belong to the recipient.
- Deferred: `invite_user` resurrection could additionally require an explicit
  admin confirmation when the old account had memberships; product call, not
  taken here.
