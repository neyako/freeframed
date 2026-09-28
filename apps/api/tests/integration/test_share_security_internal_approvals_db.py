from __future__ import annotations

from ._share_security_support import (
    Approval,
    ApprovalCreate,
    Barrier,
    BrokenBarrierError,
    HTTPException,
    ProjectRole,
    SimpleNamespace,
    ThreadPoolExecutor,
    _add_asset,
    _add_member,
    _add_version,
    _assert_forbidden,
    approvals,
    datetime,
    event,
    pytest,
    sessionmaker,
    timezone,
    uuid,
)

def test_internal_approval_requires_active_membership_and_validates_version_scope(db, make_project, make_user, monkeypatch) -> None:
    project, owner = make_project()
    editor = make_user()
    outsider = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    editor_member = _add_member(db, project.id, editor.id, ProjectRole.editor)
    asset = _add_asset(db, project.id, owner.id)
    foreign = _add_asset(db, project.id, owner.id)
    version = _add_version(db, asset)
    foreign_version = _add_version(db, foreign)
    db.commit()
    monkeypatch.setattr(approvals, "send_task_safe", lambda *args, **kwargs: None)

    created = approvals.approve_asset(asset.id, ApprovalCreate(version_id=version.id), db, editor)
    assert created.user_id == editor.id

    before = db.query(Approval).count()
    with pytest.raises(HTTPException) as exc_info:
        approvals.reject_asset(asset.id, ApprovalCreate(version_id=foreign_version.id), db, editor)
    assert exc_info.value.status_code == 404
    assert db.query(Approval).count() == before

    _assert_forbidden(lambda: approvals.approve_asset(
        asset.id, ApprovalCreate(version_id=version.id), db, outsider,
    ))
    editor_member.deleted_at = datetime.now(timezone.utc)
    db.commit()
    _assert_forbidden(lambda: approvals.approve_asset(
        asset.id, ApprovalCreate(version_id=version.id), db, editor,
    ))


@pytest.mark.parametrize("action", ["approve", "reject", "list"])
@pytest.mark.parametrize("version_state", ["foreign", "deleted", "missing"])
def test_every_internal_approval_route_rejects_invalid_version_without_writes(
    db,
    make_project,
    action,
    version_state,
    monkeypatch,
) -> None:
    project, owner = make_project()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    sibling = _add_asset(db, project.id, owner.id)
    if version_state == "foreign":
        invalid_version_id = _add_version(db, sibling).id
    elif version_state == "deleted":
        invalid_version_id = _add_version(db, asset, deleted=True).id
    else:
        invalid_version_id = uuid.uuid4()
    db.commit()
    monkeypatch.setattr(approvals, "send_task_safe", lambda *args, **kwargs: None)
    before = db.query(Approval).count()

    with pytest.raises(HTTPException) as exc_info:
        if action == "approve":
            approvals.approve_asset(
                asset.id,
                ApprovalCreate(version_id=invalid_version_id),
                db,
                owner,
            )
        elif action == "reject":
            approvals.reject_asset(
                asset.id,
                ApprovalCreate(version_id=invalid_version_id),
                db,
                owner,
            )
        else:
            approvals.list_approvals(asset.id, invalid_version_id, db, owner)

    assert exc_info.value.status_code == 404
    assert db.query(Approval).count() == before


def test_concurrent_internal_approval_upserts_one_row(
    db,
    migrated_engine,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    project, owner = make_project()
    reviewer = make_user()
    _add_member(db, project.id, reviewer.id, ProjectRole.editor)
    # Asset must belong to someone other than the reviewer: reviewing your
    # own upload is now rejected with 403.
    asset = _add_asset(db, project.id, owner.id)
    version = _add_version(db, asset)
    db.commit()
    monkeypatch.setattr(approvals, "send_task_safe", lambda *args, **kwargs: None)
    session_factory = sessionmaker(bind=migrated_engine)
    route_start_gate = Barrier(2, timeout=1)
    vulnerable_read_gate = Barrier(2, timeout=1)

    def gate_vulnerable_read(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        if "FROM approvals" not in statement:
            return
        try:
            vulnerable_read_gate.wait()
        except BrokenBarrierError:
            return

    event.listen(migrated_engine, "after_cursor_execute", gate_vulnerable_read)

    def invoke(action: str) -> None:
        session = session_factory()
        try:
            route_start_gate.wait()
            actor = SimpleNamespace(id=reviewer.id, name=reviewer.name, email=reviewer.email, is_superadmin=False)
            body = ApprovalCreate(version_id=version.id)
            if action == "approve":
                approvals.approve_asset(asset.id, body, session, actor)
            else:
                approvals.reject_asset(asset.id, body, session, actor)
        finally:
            session.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(invoke, ("approve", "reject")))
    finally:
        event.remove(migrated_engine, "after_cursor_execute", gate_vulnerable_read)

    if not vulnerable_read_gate.broken:
        pytest.fail("concurrent approvals did not serialize before vulnerable read")
    db.expire_all()
    rows = db.query(Approval).filter_by(version_id=version.id, user_id=reviewer.id).all()
    assert len(rows) == 1
