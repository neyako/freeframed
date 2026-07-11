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

from apps.api.models.project import Project, ProjectMember, ProjectType, ProjectRole
from apps.api.routers.projects import get_or_create_quick_share_project


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
