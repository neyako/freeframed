from __future__ import annotations

from ._share_security_support import (
    Approval,
    ApprovalCreate,
    HTTPException,
    ProjectRole,
    SharePermission,
    ShareVisibility,
    _add_asset,
    _add_link,
    _add_member,
    _add_version,
    _assert_forbidden,
    pytest,
    share,
)

def test_share_approval_routes_enforce_secure_signed_in_scope(db, make_project, make_user, monkeypatch) -> None:
    paths = {route.path for route in share.router.routes}
    assert "/share/{token}/assets/{asset_id}/approve" in paths
    assert "/share/{token}/assets/{asset_id}/reject" in paths
    assert "/share/{token}/assets/{asset_id}/approvals" in paths

    project, owner = make_project()
    actor = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    sibling = _add_asset(db, project.id, owner.id)
    version = _add_version(db, asset)
    foreign_version = _add_version(db, sibling)
    secure_link = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.approve,
        visibility=ShareVisibility.secure,
    )
    public_link = _add_link(db, asset, owner.id, permission=SharePermission.approve)
    wrong_permission = _add_link(
        db,
        asset,
        owner.id,
        permission=SharePermission.comment,
        visibility=ShareVisibility.secure,
    )
    db.commit()
    approve_handler = getattr(share, "approve_shared_asset", None)
    reject_handler = getattr(share, "reject_shared_asset", None)
    list_handler = getattr(share, "list_shared_approvals", None)
    assert callable(approve_handler)
    assert callable(reject_handler)
    assert callable(list_handler)
    monkeypatch.setattr(share, "send_task_safe", lambda *args, **kwargs: None)

    created = approve_handler(
        secure_link.token,
        asset.id,
        ApprovalCreate(version_id=version.id),
        share_session=None,
        db=db,
        current_user=actor,
    )
    assert created.user_id == actor.id
    listed = list_handler(
        secure_link.token,
        asset.id,
        version_id=version.id,
        share_session=None,
        db=db,
        current_user=actor,
    )
    assert [approval.id for approval in listed] == [created.id]

    with pytest.raises(HTTPException) as anonymous_error:
        reject_handler(
            secure_link.token,
            asset.id,
            ApprovalCreate(version_id=version.id),
            share_session=None,
            db=db,
            current_user=None,
        )
    assert anonymous_error.value.status_code == 401

    for blocked_link in (public_link, wrong_permission):
        _assert_forbidden(
            lambda blocked_link=blocked_link: approve_handler(
                blocked_link.token,
                asset.id,
                ApprovalCreate(version_id=version.id),
                share_session=None,
                db=db,
                current_user=actor,
            )
        )

    _assert_forbidden(
        lambda: approve_handler(
            secure_link.token,
            sibling.id,
            ApprovalCreate(version_id=foreign_version.id),
            share_session=None,
            db=db,
            current_user=actor,
        )
    )
    before = db.query(Approval).count()
    with pytest.raises(HTTPException) as foreign_error:
        approve_handler(
            secure_link.token,
            asset.id,
            ApprovalCreate(version_id=foreign_version.id),
            share_session=None,
            db=db,
            current_user=actor,
        )
    assert foreign_error.value.status_code == 404
    assert db.query(Approval).count() == before



