from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset, AssetType
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, SharePermission
from apps.api.routers import assets as asset_routes
from apps.api.routers import projects as project_routes
from apps.api.routers import users as user_routes
from apps.api.schemas.auth import InviteRequest
from apps.api.schemas.notification import AssignmentUpdate
from apps.api.schemas.project import AddProjectMemberRequest


def _add_owner_membership(db, project_id, owner_id) -> ProjectMember:
    membership = ProjectMember(
        project_id=project_id,
        user_id=owner_id,
        role=ProjectRole.owner,
    )
    db.add(membership)
    db.flush()
    return membership


def _add_asset(db, project_id, creator_id, assignee_id=None) -> Asset:
    asset = Asset(
        project_id=project_id,
        name="clip.mov",
        asset_type=AssetType.video,
        assignee_id=assignee_id,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def _add_user_grants(db, project, admin, recipient) -> tuple[ProjectMember, AssetShare]:
    asset = _add_asset(db, project.id, admin.id)
    membership = ProjectMember(
        project_id=project.id,
        user_id=recipient.id,
        role=ProjectRole.viewer,
        invited_by=admin.id,
    )
    share = AssetShare(
        asset_id=asset.id,
        shared_with_user_id=recipient.id,
        permission=SharePermission.view,
        shared_by=admin.id,
    )
    db.add_all([membership, share])
    db.commit()
    return membership, share


def test_delete_user_revokes_live_memberships_and_direct_shares(
    db,
    make_project,
    make_user,
) -> None:
    project, admin = make_project()
    admin.is_superadmin = True
    recipient = make_user()
    membership, share = _add_user_grants(db, project, admin, recipient)

    user_routes.delete_user(recipient.id, db, admin)

    db.refresh(membership)
    db.refresh(share)
    assert membership.deleted_at is not None
    assert share.deleted_at is not None


def test_reinviting_deleted_user_restores_identity_without_live_grants(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    project, admin = make_project()
    admin.is_superadmin = True
    recipient = make_user(email="returning-user@example.com")
    old_user_id = recipient.id
    _add_user_grants(db, project, admin, recipient)
    user_routes.delete_user(recipient.id, db, admin)
    monkeypatch.setattr(user_routes, "send_task_safe", lambda *args, **kwargs: None)

    resurrected = user_routes.invite_user(
        InviteRequest(email=recipient.email, name="Returning User"),
        db,
        admin,
    )

    assert resurrected.id == old_user_id
    assert db.query(ProjectMember).filter(
        ProjectMember.user_id == old_user_id,
        ProjectMember.deleted_at.is_(None),
    ).count() == 0
    assert db.query(AssetShare).filter(
        AssetShare.shared_with_user_id == old_user_id,
        AssetShare.deleted_at.is_(None),
    ).count() == 0


def test_add_project_member_rejects_unknown_and_deleted_users(
    db,
    make_project,
    make_user,
) -> None:
    project, owner = make_project()
    _add_owner_membership(db, project.id, owner.id)
    deleted_user = make_user()
    deleted_user.deleted_at = datetime.now(timezone.utc)
    db.commit()

    with pytest.raises(HTTPException) as unknown_exc:
        project_routes.add_project_member(
            project.id,
            AddProjectMemberRequest(user_id=uuid.uuid4()),
            db,
            owner,
        )
    assert unknown_exc.value.status_code == 404
    assert unknown_exc.value.detail == "User not found"

    with pytest.raises(HTTPException) as deleted_exc:
        project_routes.add_project_member(
            project.id,
            AddProjectMemberRequest(user_id=deleted_user.id),
            db,
            owner,
        )
    assert deleted_exc.value.status_code == 404
    assert deleted_exc.value.detail == "User not found"


def test_update_assignment_rejects_deleted_user_and_allows_clearing(
    db,
    make_project,
    make_user,
) -> None:
    project, admin = make_project()
    admin.is_superadmin = True
    deleted_user = make_user()
    deleted_user.deleted_at = datetime.now(timezone.utc)
    asset = _add_asset(db, project.id, admin.id, assignee_id=deleted_user.id)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        asset_routes.update_assignment(
            asset.id,
            AssignmentUpdate(assignee_id=deleted_user.id),
            db,
            admin,
        )
    assert exc.value.status_code == 404
    assert exc.value.detail == "User not found"

    response = asset_routes.update_assignment(
        asset.id,
        AssignmentUpdate(assignee_id=None),
        db,
        admin,
    )

    db.refresh(asset)
    assert response.assignee_id is None
    assert asset.assignee_id is None
