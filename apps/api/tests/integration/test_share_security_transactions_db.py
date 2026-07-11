from __future__ import annotations

from ._share_security_support import (
    ActivityLog,
    Approval,
    AssetShare,
    DirectShareCreate,
    HTTPException,
    ProjectRole,
    ShareLink,
    SharePermission,
    _add_asset,
    _add_folder,
    _add_member,
    _add_version,
    _assert_forbidden,
    approvals,
    pytest,
    share,
    uuid,
)

def test_team_routes_authorize_then_return_501_without_writes(db, make_project, make_user) -> None:
    project, owner = make_project()
    editor = make_user()
    reviewer = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    _add_member(db, project.id, editor.id, ProjectRole.editor)
    _add_member(db, project.id, reviewer.id, ProjectRole.reviewer)
    asset = _add_asset(db, project.id, owner.id)
    folder = _add_folder(db, project.id, owner.id)
    body = DirectShareCreate(team_id=uuid.uuid4(), permission=SharePermission.comment)

    for manager, call in (
        (editor, lambda actor: share.share_with_team(asset.id, body, db, actor)),
        (owner, lambda actor: share.share_folder_with_team(folder.id, body, db, actor)),
    ):
        before = db.query(AssetShare).count()
        with pytest.raises(HTTPException) as exc_info:
            call(manager)
        assert exc_info.value.status_code == 501
        assert db.query(AssetShare).count() == before

    _assert_forbidden(lambda: share.share_with_team(asset.id, body, db, reviewer))
    _assert_forbidden(lambda: share.share_folder_with_team(folder.id, body, db, reviewer))



def test_approval_and_reviewer_builders_rollback_all_staged_rows(db, make_project, make_user) -> None:
    import importlib

    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    version = _add_version(db, asset)
    db.commit()

    approval_module = importlib.util.find_spec("apps.api.services.approval_service")
    spec_type = getattr(share, "ReviewerShareSpec", None)
    assert approval_module is not None
    assert spec_type is not None
    approval_service = importlib.import_module("apps.api.services.approval_service")

    approval_service.upsert_approval(
        db,
        asset,
        version.id,
        actor,
        approvals.ApprovalStatus.approved,
        None,
    )
    staged_link = share.create_reviewer_share(db, asset, spec_type(created_by=owner.id))
    staged_link_id = staged_link.id
    db.rollback()

    assert db.query(Approval).count() == 0
    assert db.query(ShareLink).filter_by(id=staged_link_id).count() == 0
    assert db.query(ActivityLog).filter_by(asset_id=asset.id).count() == 0



