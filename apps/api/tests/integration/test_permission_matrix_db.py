from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset, AssetType
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.services import permissions


def _add_member(db, project_id, user_id, role: ProjectRole) -> ProjectMember:
    member = ProjectMember(project_id=project_id, user_id=user_id, role=role)
    db.add(member)
    db.flush()
    return member


def _add_asset(db, project_id, creator_id) -> Asset:
    asset = Asset(
        project_id=project_id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def test_asset_access_is_members_and_superadmin_only(db, make_project, make_user) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    actors = {name: make_user() for name in ("owner", "editor", "outsider", "superadmin")}
    _add_member(db, project.id, actors["owner"].id, ProjectRole.owner)
    _add_member(db, project.id, actors["editor"].id, ProjectRole.editor)
    actors["superadmin"].is_superadmin = True
    db.flush()

    actual = {name: permissions.can_access_asset(db, asset, actor) for name, actor in actors.items()}

    assert actual == {"owner": True, "editor": True, "outsider": False, "superadmin": True}


def test_asset_access_ignores_soft_deleted_membership(db, make_project) -> None:
    project, creator = make_project()
    member = _add_member(db, project.id, creator.id, ProjectRole.editor)
    asset = _add_asset(db, project.id, creator.id)
    member.deleted_at = datetime.now(timezone.utc)
    db.flush()

    assert permissions.can_access_asset(db, asset, creator) is False


def test_soft_deleted_asset_denies_member(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    _add_member(db, project.id, actor.id, ProjectRole.editor)
    asset = _add_asset(db, project.id, owner.id)
    asset.deleted_at = datetime.now(timezone.utc)
    db.flush()

    assert permissions.can_access_asset(db, asset, actor) is False


@pytest.mark.parametrize(
    ("role", "minimum", "allowed"),
    [
        (ProjectRole.owner, ProjectRole.owner, True),
        (ProjectRole.owner, ProjectRole.editor, True),
        (ProjectRole.editor, ProjectRole.editor, True),
        (ProjectRole.editor, ProjectRole.owner, False),
        (None, ProjectRole.editor, False),
    ],
)
def test_require_project_role_ranks_owner_above_editor(
    db,
    make_project,
    make_user,
    role: ProjectRole | None,
    minimum: ProjectRole,
    allowed: bool,
) -> None:
    project, _owner = make_project()
    actor = make_user()
    if role is not None:
        _add_member(db, project.id, actor.id, role)

    if allowed:
        assert permissions.require_project_role(db, project.id, actor, minimum).role == role
    else:
        with pytest.raises(HTTPException) as exc_info:
            permissions.require_project_role(db, project.id, actor, minimum)
        assert exc_info.value.status_code == 403
