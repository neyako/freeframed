from __future__ import annotations

from ._share_security_support import (
    ActivityLog,
    Approval,
    ShareLink,
    _add_asset,
    _add_version,
    approvals,
    share,
)


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

