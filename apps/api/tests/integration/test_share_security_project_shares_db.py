from __future__ import annotations

from threading import Barrier, Event

from sqlalchemy import text

from ._share_security_support import (
    AssetShare,
    DirectShareCreate,
    HTTPException,
    ProjectMember,
    ProjectRole,
    SharePermission,
    SimpleNamespace,
    ThreadPoolExecutor,
    _add_asset,
    _add_folder,
    _add_member,
    _assert_forbidden,
    datetime,
    event,
    pytest,
    sessionmaker,
    share,
    timezone,
)

@pytest.mark.parametrize(
    ("permission", "expected_role"),
    [
        (SharePermission.view, ProjectRole.viewer),
        (SharePermission.comment, ProjectRole.reviewer),
        (SharePermission.approve, ProjectRole.reviewer),
    ],
)
def test_owner_project_direct_share_persists_real_membership(
    db,
    make_project,
    make_user,
    monkeypatch,
    permission,
    expected_role,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)

    response = share.share_project_with_user(
        project.id,
        DirectShareCreate(user_id=recipient.id, permission=permission),
        db,
        owner,
    )
    membership = db.query(ProjectMember).filter_by(project_id=project.id, user_id=recipient.id).one()

    assert response.id == membership.id
    assert response.project_id == project.id
    assert response.shared_with_user_id == recipient.id
    assert response.permission == permission
    assert membership.role == expected_role


def test_project_direct_share_is_owner_only_and_does_not_downgrade(db, make_project, make_user, monkeypatch) -> None:
    project, owner = make_project()
    editor = make_user()
    recipient = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    _add_member(db, project.id, editor.id, ProjectRole.editor)
    membership = _add_member(db, project.id, recipient.id, ProjectRole.editor)
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)

    _assert_forbidden(
        lambda: share.share_project_with_user(
            project.id,
            DirectShareCreate(user_id=recipient.id),
            db,
            editor,
        )
    )
    share.share_project_with_user(
        project.id,
        DirectShareCreate(user_id=recipient.id, permission=SharePermission.view),
        db,
        owner,
    )
    assert membership.role == ProjectRole.editor


def test_project_direct_share_reactivates_at_requested_role_and_rejects_deleted_user(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    deleted_user = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    stale = _add_member(db, project.id, recipient.id, ProjectRole.owner)
    stale.deleted_at = datetime.now(timezone.utc)
    deleted_user.deleted_at = datetime.now(timezone.utc)
    db.commit()
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)

    share.share_project_with_user(
        project.id,
        DirectShareCreate(user_id=recipient.id, permission=SharePermission.view),
        db,
        owner,
    )
    assert stale.deleted_at is None
    assert stale.role == ProjectRole.viewer

    before = db.query(ProjectMember).count()
    with pytest.raises(HTTPException) as exc_info:
        share.share_project_with_user(
            project.id,
            DirectShareCreate(user_id=deleted_user.id),
            db,
            owner,
        )
    assert exc_info.value.status_code == 404
    assert db.query(ProjectMember).count() == before


@pytest.mark.parametrize("target_kind", ["asset", "folder"])
def test_direct_share_authorizes_before_resolving_recipient_email(
    db,
    make_project,
    make_user,
    target_kind,
) -> None:
    project, owner = make_project()
    reviewer = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    _add_member(db, project.id, reviewer.id, ProjectRole.reviewer)
    asset = _add_asset(db, project.id, owner.id)
    folder = _add_folder(db, project.id, owner.id)
    body = DirectShareCreate(email="missing-recipient@invalid.test")

    if target_kind == "asset":
        call = lambda: share.share_with_user(asset.id, body, db, reviewer)
    else:
        call = lambda: share.share_folder_with_user(folder.id, body, db, reviewer)
    _assert_forbidden(call)


@pytest.mark.parametrize("target_kind", ["asset", "folder"])
def test_direct_share_rejects_soft_deleted_recipient_without_writes(
    db,
    make_project,
    make_user,
    monkeypatch,
    target_kind,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    recipient.deleted_at = datetime.now(timezone.utc)
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    folder = _add_folder(db, project.id, owner.id)
    db.commit()
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)
    body = DirectShareCreate(user_id=recipient.id)
    before = db.query(AssetShare).count()

    if target_kind == "asset":
        call = lambda: share.share_with_user(asset.id, body, db, owner)
    else:
        call = lambda: share.share_folder_with_user(folder.id, body, db, owner)
    with pytest.raises(HTTPException) as exc_info:
        call()
    assert exc_info.value.status_code == 404
    assert db.query(AssetShare).count() == before


def test_concurrent_project_direct_shares_create_one_membership_without_downgrade(
    db,
    migrated_engine,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    db.commit()
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)
    session_factory = sessionmaker(bind=migrated_engine)
    lock_attempt_gate = Barrier(2, timeout=5)
    winner_acquired = Event()
    release_winner = Event()
    original_lock = share._lock_active_project

    def align_project_lock_attempts(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        if statement.lstrip().startswith("SELECT projects.") and "FOR UPDATE" in statement:
            lock_attempt_gate.wait()

    def hold_first_project_lock(session, project_id):
        locked_project = original_lock(session, project_id)
        winner_acquired.set()
        if not release_winner.wait(timeout=5):
            raise AssertionError("project lock winner was not released")
        return locked_project

    event.listen(migrated_engine, "before_cursor_execute", align_project_lock_attempts)
    monkeypatch.setattr(share, "_lock_active_project", hold_first_project_lock)

    def invoke(permission: SharePermission) -> None:
        session = session_factory()
        try:
            actor = SimpleNamespace(id=owner.id, name=owner.name, email=owner.email)
            share.share_project_with_user(
                project.id,
                DirectShareCreate(user_id=recipient.id, permission=permission),
                session,
                actor,
            )
        finally:
            session.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(invoke, permission) for permission in (SharePermission.approve, SharePermission.view)]
            if not winner_acquired.wait(timeout=5):
                pytest.fail("no project lock winner acquired within timeout")
            with migrated_engine.connect() as connection:
                for _attempt in range(100):
                    lock_waiters = connection.execute(text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND wait_event_type = 'Lock' "
                        "AND query LIKE '%FROM projects%' AND query LIKE '%FOR UPDATE%'"
                    )).scalar_one()
                    if lock_waiters:
                        break
                if lock_waiters != 1:
                    pytest.fail(f"expected one PostgreSQL project-row lock waiter, got {lock_waiters}")
            release_winner.set()
            for future in futures:
                future.result(timeout=5)
    finally:
        release_winner.set()
        event.remove(migrated_engine, "before_cursor_execute", align_project_lock_attempts)

    db.expire_all()
    memberships = db.query(ProjectMember).filter_by(project_id=project.id, user_id=recipient.id).all()
    assert len(memberships) == 1
    assert memberships[0].role == ProjectRole.reviewer
