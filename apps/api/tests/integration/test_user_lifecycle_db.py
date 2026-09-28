from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.routers import projects as project_routes
from apps.api.routers import users as user_routes
from apps.api.schemas.auth import InviteRequest
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
    now = datetime.now(timezone.utc)
    db.add(ProjectMember(
        project_id=project.id,
        user_id=recipient.id,
        role=ProjectRole.editor,
        deleted_at=now,
    ))
    recipient.deleted_at = now
    db.commit()
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
