from __future__ import annotations

from ._share_security_support import (
    AssetShare,
    Barrier,
    BrokenBarrierError,
    DirectShareCreate,
    ProjectRole,
    SharePermission,
    SimpleNamespace,
    ThreadPoolExecutor,
    _add_asset,
    _add_folder,
    _add_member,
    event,
    pytest,
    sessionmaker,
    share,
)

@pytest.mark.parametrize("target_kind", ["asset", "folder"])
def test_concurrent_direct_shares_create_one_active_grant(
    db,
    migrated_engine,
    make_project,
    make_user,
    monkeypatch,
    target_kind,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    folder = _add_folder(db, project.id, owner.id)
    db.commit()
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)
    session_factory = sessionmaker(bind=migrated_engine)
    vulnerable_read_gate = Barrier(2, timeout=1)

    def gate_vulnerable_read(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        if "FROM asset_shares" not in statement or "shared_with_user_id" not in statement:
            return
        try:
            vulnerable_read_gate.wait()
        except BrokenBarrierError:
            return

    event.listen(migrated_engine, "after_cursor_execute", gate_vulnerable_read)

    def invoke(permission: SharePermission) -> None:
        session = session_factory()
        try:
            actor = SimpleNamespace(id=owner.id, name=owner.name, email=owner.email)
            body = DirectShareCreate(user_id=recipient.id, permission=permission)
            if target_kind == "asset":
                share.share_with_user(asset.id, body, session, actor)
            else:
                share.share_folder_with_user(folder.id, body, session, actor)
        finally:
            session.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(invoke, (SharePermission.approve, SharePermission.view)))
    finally:
        event.remove(migrated_engine, "after_cursor_execute", gate_vulnerable_read)

    db.expire_all()
    query = db.query(AssetShare).filter(
        AssetShare.shared_with_user_id == recipient.id,
        AssetShare.deleted_at.is_(None),
    )
    query = (
        query.filter(AssetShare.asset_id == asset.id)
        if target_kind == "asset"
        else query.filter(AssetShare.folder_id == folder.id)
    )
    grants = query.all()
    assert len(grants) == 1
    assert grants[0].permission in {SharePermission.approve, SharePermission.view}


@pytest.mark.parametrize("target_kind", ["asset", "folder"])
def test_sequential_direct_share_upsert_honors_requested_downgrade(
    db,
    make_project,
    make_user,
    monkeypatch,
    target_kind,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    folder = _add_folder(db, project.id, owner.id)
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)

    if target_kind == "asset":
        share.share_with_user(
            asset.id,
            DirectShareCreate(user_id=recipient.id, permission=SharePermission.approve),
            db,
            owner,
        )
        updated = share.share_with_user(
            asset.id,
            DirectShareCreate(user_id=recipient.id, permission=SharePermission.view),
            db,
            owner,
        )
    else:
        share.share_folder_with_user(
            folder.id,
            DirectShareCreate(user_id=recipient.id, permission=SharePermission.approve),
            db,
            owner,
        )
        updated = share.share_folder_with_user(
            folder.id,
            DirectShareCreate(user_id=recipient.id, permission=SharePermission.view),
            db,
            owner,
        )

    assert updated.permission == SharePermission.view


def test_folder_share_revocation_removes_semantic_duplicates(db, make_project, make_user) -> None:
    project, owner = make_project()
    recipient = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    folder = _add_folder(db, project.id, owner.id)
    grants = [
        AssetShare(
            folder_id=folder.id,
            shared_with_user_id=recipient.id,
            permission=SharePermission.approve,
            shared_by=owner.id,
        ),
        AssetShare(
            folder_id=folder.id,
            shared_with_user_id=recipient.id,
            permission=SharePermission.view,
            shared_by=owner.id,
        ),
    ]
    db.add_all(grants)
    db.commit()

    share.delete_folder_share(folder.id, grants[0].id, db, owner)

    db.expire_all()
    active = db.query(AssetShare).filter(
        AssetShare.folder_id == folder.id,
        AssetShare.shared_with_user_id == recipient.id,
        AssetShare.deleted_at.is_(None),
    ).count()
    assert active == 0



