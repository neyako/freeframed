from __future__ import annotations

from datetime import datetime, timezone

import pytest

from apps.api.models.asset import AssetVersion

from ._folder_scope_support import build_folder_scope_world, folder_scope_client


def _version_for(db, asset_id):
    return db.query(AssetVersion).filter_by(asset_id=asset_id).one()


def test_foreign_version_is_rejected_by_comments_and_approvals(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    foreign_version = _version_for(db, world.asset_b.id)

    with folder_scope_client(db, world.recipient) as client:
        comments = client.get(
            f"/assets/{world.asset_a1.id}/comments",
            params={"version_id": str(foreign_version.id)},
        )
        approvals = client.get(
            f"/assets/{world.asset_a1.id}/approvals",
            params={"version_id": str(foreign_version.id)},
        )

    assert comments.status_code == 404
    assert approvals.status_code == 404


def test_revocation_blocks_comments_and_approvals_exactly(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    version = _version_for(db, world.asset_a1.id)
    revoked_at = datetime.now(timezone.utc)
    for grant in world.grants:
        grant.deleted_at = revoked_at
    db.commit()

    with folder_scope_client(db, world.recipient) as client:
        comments = client.get(
            f"/assets/{world.asset_a1.id}/comments",
            params={"version_id": str(version.id)},
        )
        approvals = client.get(
            f"/assets/{world.asset_a1.id}/approvals",
            params={"version_id": str(version.id)},
        )

    assert comments.status_code == 403
    assert approvals.status_code == 403


def test_deleted_folder_asset_and_version_are_absent(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    now = datetime.now(timezone.utc)
    version = _version_for(db, world.asset_a.id)
    world.child_a1.deleted_at = now
    world.asset_b.deleted_at = now
    version.deleted_at = now
    db.commit()

    with folder_scope_client(db, world.recipient) as client:
        folder = client.get(
            f"/projects/{world.project.id}/folders",
            params={"parent_id": str(world.child_a1.id)},
        )
        asset = client.get(f"/assets/{world.asset_b.id}")
        stream = client.get(
            f"/assets/{world.asset_a.id}/stream",
            params={"version_id": str(version.id)},
        )

    assert folder.status_code == 404
    assert asset.status_code == 404
    assert stream.status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/projects/not-a-uuid",
        "/assets/not-a-uuid",
        "/folders/not-a-uuid/shares",
    ],
)
def test_invalid_uuid_paths_are_rejected(db, make_project, make_user, path) -> None:
    world = build_folder_scope_world(db, make_project, make_user)

    with folder_scope_client(db, world.recipient) as client:
        response = client.get(path)

    assert response.status_code == 422
