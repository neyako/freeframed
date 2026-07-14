"""
Project endpoint tests.

DB is mocked; auth is bypassed via auth_headers fixture.
The projects router uses POST /projects (with org_id in body) and GET /projects.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

from apps.api.models.asset import Asset
from apps.api.models.project import Project, ProjectMember, ProjectType, ProjectRole
from apps.api.routers import projects as projects_router
from apps.api.routers.projects import get_or_create_quick_share_project
from apps.api.services import permissions


def _mock_project(
    org_id: uuid.UUID,
    created_by: uuid.UUID,
    name: str = "Test Project",
) -> MagicMock:
    p = MagicMock()
    p.id = uuid.uuid4()
    p.org_id = org_id
    p.team_id = None
    p.name = name
    p.description = None
    p.project_type = ProjectType.personal
    p.created_by = created_by
    p.created_at = datetime.now(timezone.utc)
    p.deleted_at = None
    p.is_public = False
    p.is_quick_share = False
    p.poster_url = None
    p.poster_s3_key = None
    p.asset_count = 0
    p.storage_bytes = 0
    p.member_count = 1
    p.role = None
    return p


def _mock_project_member(project_id: uuid.UUID, user_id: uuid.UUID, role: ProjectRole = ProjectRole.owner) -> MagicMock:
    m = MagicMock()
    m.id = uuid.uuid4()
    m.project_id = project_id
    m.user_id = user_id
    m.role = role
    m.invited_by = None
    m.deleted_at = None
    return m


def test_create_project(client, auth_headers, mock_db, test_user):
    """POST /projects — happy path returns 201."""
    org_id = uuid.uuid4()

    def _refresh_side_effect(obj):
        obj.id = uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)
        obj.deleted_at = None
        obj.team_id = None
        obj.description = None
        obj.project_type = ProjectType.personal
        obj.is_public = False
        obj.is_quick_share = False
        obj.poster_url = None
        obj.created_by = test_user.id
        obj.org_id = org_id
        obj.name = "Test Project"

    mock_db.refresh.side_effect = _refresh_side_effect

    resp = client.post(
        "/projects",
        json={"name": "Test Project", "org_id": str(org_id)},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Test Project"


def test_quick_share_returns_existing_owned_project_unchanged(mock_db, test_user):
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id, "Quick Shares")
    proj.is_quick_share = True

    mock_db.order_by.return_value = mock_db
    mock_db.first.return_value = proj

    result = get_or_create_quick_share_project(db=mock_db, current_user=test_user)

    assert result is proj
    assert mock_db.first.call_count == 1
    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_called()

def test_quick_share_creates_owned_project_and_owner_membership(mock_db, test_user):
    mock_db.order_by.return_value = mock_db
    mock_db.first.return_value = None

    result = get_or_create_quick_share_project(db=mock_db, current_user=test_user)

    added_project = next(
        call.args[0] for call in mock_db.add.call_args_list if isinstance(call.args[0], Project)
    )
    added_member = next(
        call.args[0] for call in mock_db.add.call_args_list if isinstance(call.args[0], ProjectMember)
    )
    assert result is added_project
    assert added_project.is_quick_share is True
    assert added_project.created_by == test_user.id
    assert added_member.project_id == added_project.id
    assert added_member.user_id == test_user.id
    assert added_member.role == ProjectRole.owner


def test_quick_share_integrity_error_rolls_back_and_returns_owned_winner(
    mock_db, test_user
):
    winner = _mock_project(uuid.uuid4(), test_user.id, "Quick Shares")
    winner.is_quick_share = True
    mock_db.order_by.return_value = mock_db
    mock_db.first.side_effect = [None, winner]
    mock_db.flush.side_effect = IntegrityError("insert", {}, RuntimeError("duplicate"))

    result = get_or_create_quick_share_project(db=mock_db, current_user=test_user)

    assert result is winner
    mock_db.rollback.assert_called_once()
    mock_db.commit.assert_not_called()


def test_quick_share_unexpected_integrity_error_without_owned_winner_is_raised(
    mock_db, test_user
):
    error = IntegrityError("insert", {}, RuntimeError("unexpected"))
    mock_db.order_by.return_value = mock_db
    mock_db.first.side_effect = [None, None]
    mock_db.flush.side_effect = error

    with pytest.raises(IntegrityError) as raised:
        get_or_create_quick_share_project(db=mock_db, current_user=test_user)

    assert raised.value is error
    mock_db.rollback.assert_called_once()


def test_list_projects(client, auth_headers, mock_db, test_user):
    """GET /projects — returns empty list when no memberships."""
    # The list_projects router does complex joins (memberships, asset counts,
    # storage, member counts).  With a mock DB every chained call returns the
    # same MagicMock, so the simplest reliable assertion is an empty result.
    mock_db.all.return_value = []  # no memberships → no projects

    resp = client.get("/projects", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_project(client, auth_headers, mock_db, test_user):
    """GET /projects/{project_id} — returns project for member."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id)
    member = _mock_project_member(proj.id, test_user.id)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj
        return member

    mock_db.first.side_effect = _first_side_effect

    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)
    assert resp.status_code == 200


def test_get_project_not_member(client, auth_headers, mock_db, test_user):
    """GET /projects/{project_id} — 403 if user is not a member."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj
        return None  # no membership

    mock_db.first.side_effect = _first_side_effect

    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)
    assert resp.status_code == 403


def test_asset_scoped_project_assets_reuse_asset_access(
    mock_db,
    test_user,
    monkeypatch,
):
    # Given
    project_id = uuid.uuid4()
    assigned = MagicMock(spec=Asset)
    assigned.id = uuid.uuid4()
    shared = MagicMock(spec=Asset)
    shared.id = uuid.uuid4()
    denied = MagicMock(spec=Asset)
    denied.id = uuid.uuid4()
    mock_db.all.return_value = [assigned, shared, denied]
    access_by_id = {
        assigned.id: permissions.AssetAccess(True, True, True, False, None),
        shared.id: permissions.AssetAccess(True, True, False, False, None),
        denied.id: permissions.AssetAccess(False, False, False, False, None),
    }
    monkeypatch.setattr(
        permissions,
        "get_asset_access",
        lambda _db, asset, _user: access_by_id[asset.id],
    )

    # When
    assets = permissions.get_asset_scoped_project_assets(mock_db, project_id, test_user)

    # Then
    assert assets == [assigned, shared]


def test_get_project_asset_scope_returns_minimal_envelope(
    client,
    auth_headers,
    mock_db,
    test_user,
    monkeypatch,
):
    # Given
    proj = _mock_project(uuid.uuid4(), uuid.uuid4(), "Private Quick Share")
    accessible_assets = [MagicMock(id=uuid.uuid4()), MagicMock(id=uuid.uuid4())]
    mock_db.first.side_effect = [proj, None]
    mock_db.outerjoin.return_value = mock_db
    mock_db.one.return_value = (2, 456)
    monkeypatch.setattr(projects_router, "resolve_folder_access", lambda *_args: None)
    monkeypatch.setattr(
        projects_router,
        "get_asset_scoped_project_assets",
        lambda *_args: accessible_assets,
        raising=False,
    )

    # When
    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)

    # Then
    assert resp.status_code == 200
    assert resp.json() == {
        "id": str(proj.id),
        "name": "Private Quick Share",
        "asset_count": 2,
        "storage_bytes": 456,
        "member_count": 0,
        "role": None,
        "folder_access": {
            "kind": "folder_direct",
            "accessible_root_ids": [],
            "grants": [],
        },
    }


def test_get_project_superadmin_bypasses_membership_checks(
    client,
    auth_headers,
    mock_db,
    test_user,
    monkeypatch,
):
    # Given
    proj = _mock_project(uuid.uuid4(), uuid.uuid4())
    test_user.is_superadmin = True
    mock_db.first.side_effect = [proj, None]
    mock_db.scalar.return_value = 0
    resolve_folder_access = MagicMock(return_value=None)
    monkeypatch.setattr(projects_router, "resolve_folder_access", resolve_folder_access)

    # When
    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)

    # Then
    assert resp.status_code == 200
    assert resp.json()["role"] == "owner"
    assert resp.json()["folder_access"] is None
    resolve_folder_access.assert_not_called()


def test_get_project_rejects_unrelated_private_user_after_asset_scope_check(
    client,
    auth_headers,
    mock_db,
    test_user,
    monkeypatch,
):
    # Given
    proj = _mock_project(uuid.uuid4(), uuid.uuid4())
    mock_db.first.side_effect = [proj, None]
    monkeypatch.setattr(projects_router, "resolve_folder_access", lambda *_args: None)
    monkeypatch.setattr(
        projects_router,
        "get_asset_scoped_project_assets",
        lambda *_args: [],
        raising=False,
    )

    # When
    resp = client.get(f"/projects/{proj.id}", headers=auth_headers)

    # Then
    assert resp.status_code == 403


def test_delete_project(client, auth_headers, mock_db, test_user):
    """DELETE /projects/{project_id} — owner can delete, returns 204."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id)
    member = _mock_project_member(proj.id, test_user.id, ProjectRole.owner)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj
        return member

    mock_db.first.side_effect = _first_side_effect

    resp = client.delete(f"/projects/{proj.id}", headers=auth_headers)
    assert resp.status_code == 204


def test_update_project(client, auth_headers, mock_db, test_user):
    """PATCH /projects/{project_id} — owner can update name."""
    org_id = uuid.uuid4()
    proj = _mock_project(org_id, test_user.id, "Old Name")
    member = _mock_project_member(proj.id, test_user.id, ProjectRole.owner)

    call_count = 0

    def _first_side_effect():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return proj  # _get_project
        return member    # _require_project_owner

    mock_db.first.side_effect = _first_side_effect

    def _refresh_side_effect(obj):
        obj.name = "New Name"

    mock_db.refresh.side_effect = _refresh_side_effect

    resp = client.patch(
        f"/projects/{proj.id}",
        json={"name": "New Name"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
