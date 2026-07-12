from __future__ import annotations

from ._share_security_support import (
    Approval,
    ApprovalCreate,
    AssetVersion,
    HTTPException,
    ProcessingStatus,
    SharePermission,
    ShareVisibility,
    _add_asset,
    _add_link,
    _add_version,
    _assert_forbidden,
    datetime,
    pytest,
    share,
    timedelta,
    timezone,
    uuid,
)

@pytest.mark.parametrize("action", ["approve", "reject", "list"])
@pytest.mark.parametrize("version_state", ["deleted", "missing"])
def test_every_share_approval_route_rejects_invalid_in_scope_version(
    db,
    make_project,
    make_user,
    monkeypatch,
    action,
    version_state,
) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    invalid_version_id = (
        _add_version(db, asset, deleted=True).id
        if version_state == "deleted"
        else uuid.uuid4()
    )
    link = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    db.commit()
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)
    before = db.query(Approval).count()

    with pytest.raises(HTTPException) as exc_info:
        if action == "approve":
            share.approve_shared_asset(
                link.token,
                asset.id,
                ApprovalCreate(version_id=invalid_version_id),
                None,
                db,
                actor,
            )
        elif action == "reject":
            share.reject_shared_asset(
                link.token,
                asset.id,
                ApprovalCreate(version_id=invalid_version_id),
                None,
                db,
                actor,
            )
        else:
            share.list_shared_approvals(
                link.token,
                asset.id,
                invalid_version_id,
                None,
                db,
                actor,
            )

    assert exc_info.value.status_code == 404
    assert db.query(Approval).count() == before


@pytest.mark.parametrize("action", ["approve", "reject", "list"])
def test_every_share_approval_route_rejects_hidden_older_version(
    db,
    make_project,
    make_user,
    monkeypatch,
    action,
) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    older = _add_version(db, asset)
    latest = AssetVersion(
        asset_id=asset.id,
        version_number=2,
        processing_status=ProcessingStatus.ready,
        created_by=owner.id,
    )
    db.add(latest)
    link = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    link.show_versions = False
    db.commit()
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)
    before = db.query(Approval).count()

    with pytest.raises(HTTPException) as exc_info:
        if action == "approve":
            share.approve_shared_asset(
                link.token,
                asset.id,
                ApprovalCreate(version_id=older.id),
                None,
                db,
                actor,
            )
        elif action == "reject":
            share.reject_shared_asset(
                link.token,
                asset.id,
                ApprovalCreate(version_id=older.id),
                None,
                db,
                actor,
            )
        else:
            share.list_shared_approvals(
                link.token,
                asset.id,
                older.id,
                None,
                db,
                actor,
            )

    assert exc_info.value.status_code == 404
    assert db.query(Approval).count() == before


def test_share_approval_rejects_wrong_session_stale_links_and_scoped_list(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    sibling = _add_asset(db, project.id, owner.id)
    version = _add_version(db, asset)
    password_link = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    password_link.password_hash = "synthetic-hash"
    disabled = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    disabled.is_enabled = False
    expired = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    expired.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    deleted = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    deleted.deleted_at = datetime.now(timezone.utc)
    db.commit()
    monkeypatch.setattr(share, "verify_share_session", lambda token, session: False)

    _assert_forbidden(
        lambda: share.approve_shared_asset(
            password_link.token,
            asset.id,
            ApprovalCreate(version_id=version.id),
            "wrong-session",
            db,
            actor,
        )
    )
    for link, expected in ((disabled, 403), (expired, 410), (deleted, 404)):
        with pytest.raises(HTTPException) as exc_info:
            share.approve_shared_asset(
                link.token,
                asset.id,
                ApprovalCreate(version_id=version.id),
                None,
                db,
                actor,
            )
        assert exc_info.value.status_code == expected

    scoped = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    db.commit()
    _assert_forbidden(
        lambda: share.list_shared_approvals(
            scoped.token,
            sibling.id,
            version.id,
            None,
            db,
            actor,
        )
    )
