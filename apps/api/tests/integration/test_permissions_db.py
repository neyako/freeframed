from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset, AssetType
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.models.share import ShareLink
from apps.api.services import permissions
from apps.api.services.permissions import require_project_role


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


def test_require_project_role_allows_transient_superadmin_owner(
    db,
    make_project,
    make_user,
) -> None:
    project, _owner = make_project()
    superadmin = make_user()
    superadmin.is_superadmin = True
    db.flush()

    member = require_project_role(db, project.id, superadmin, ProjectRole.owner)

    assert member.project_id == project.id
    assert member.user_id == superadmin.id
    assert member.role == ProjectRole.owner
    assert member not in db


def test_require_project_role_ignores_soft_deleted_membership(
    db,
    make_project,
    make_user,
) -> None:
    project, _owner = make_project()
    editor = make_user()
    member = _add_member(db, project.id, editor.id, ProjectRole.editor)
    member.deleted_at = datetime.now(timezone.utc)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        require_project_role(db, project.id, editor, ProjectRole.editor)

    assert exc.value.status_code == 403
    assert exc.value.detail == "Not a project member"


def test_get_share_link_project_id_resolves_asset_link(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    link = ShareLink(
        asset_id=asset.id,
        token="synthetic-permission-link",
        created_by=owner.id,
    )
    db.add(link)
    db.flush()

    project_id = permissions.get_share_link_project_id(db, link)

    assert project_id == project.id
