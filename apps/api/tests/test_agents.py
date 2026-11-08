"""Agent accounts: token auth, editor-level access, no approvals."""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from apps.api.middleware.auth import get_current_user
from apps.api.models.project import ProjectRole
from apps.api.models.user import UserStatus
from apps.api.routers import agents, approvals, projects
from apps.api.schemas.project import ProjectCreate
from apps.api.schemas.approval import ApprovalCreate
from apps.api.services import agent_service
from apps.api.services.permissions import require_project_role


def _agent(**kw):
    return SimpleNamespace(
        id=uuid.uuid4(), name="Claude", is_agent=True, is_superadmin=False,
        status=UserStatus.active, deleted_at=None, **kw,
    )


def _bearer(token):
    return SimpleNamespace(credentials=token)


def test_agent_token_resolves_to_its_account():
    agent = _agent()
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = agent

    assert get_current_user(MagicMock(), _bearer("ffd_secret"), db) is agent


def test_unknown_agent_token_is_rejected():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    with pytest.raises(HTTPException) as exc:
        get_current_user(MagicMock(), _bearer("ffd_wrong"), db)
    assert exc.value.status_code == 401


def test_deactivated_agent_token_is_rejected():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = _agent()
    db.query.return_value.filter.return_value.first.return_value.status = UserStatus.deactivated

    assert agent_service.user_for_api_token(db, "ffd_secret") is None


def test_issued_token_is_stored_only_as_its_hash():
    agent = _agent(api_token_hash=None)
    token = agent_service.issue_token(agent)

    assert token.startswith("ffd_")
    assert agent.api_token_hash == agent_service.hash_token(token)
    assert token not in agent.api_token_hash


def test_agent_is_editor_on_every_project_but_never_owner():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None  # not a member
    agent = _agent()

    member = require_project_role(db, uuid.uuid4(), agent, ProjectRole.editor)
    assert member.role == ProjectRole.editor
    with pytest.raises(HTTPException) as exc:
        require_project_role(db, uuid.uuid4(), agent, ProjectRole.owner)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("route", [approvals.approve_asset, approvals.reject_asset])
def test_agent_cannot_approve_or_reject(route):
    body = ApprovalCreate(version_id=uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        route(uuid.uuid4(), body, MagicMock(), _agent())
    assert exc.value.status_code == 403


@pytest.mark.parametrize("call", [
    lambda agent: projects.create_project(ProjectCreate(name="Mine"), MagicMock(), agent),
    lambda agent: projects.get_or_create_quick_share_project(MagicMock(), agent),
])
def test_agent_cannot_create_a_project_and_become_its_owner(call):
    with pytest.raises(HTTPException) as exc:
        call(_agent())
    assert exc.value.status_code == 403


def _agent_db(found):
    db = MagicMock()
    db.query.return_value.filter.return_value.filter.return_value.first.return_value = found
    db.query.return_value.filter.return_value.first.return_value = found
    return db


def test_connecting_a_preset_returns_the_token_once():
    db = _agent_db(None)

    resp = agents.connect_agent("claude", db, SimpleNamespace(id=uuid.uuid4()))

    added = db.add.call_args.args[0]
    assert added.is_agent is True
    assert (added.name, added.email, added.avatar_url) == (
        "Claude", "claude@agents.freeframed.local", "/agents/claude.svg")
    assert added.password_hash is None
    assert added.api_token_hash == agent_service.hash_token(resp.token)
    assert resp.agent.connected_at is not None


def test_connecting_a_connected_preset_conflicts():
    db = _agent_db(_agent(api_token_hash="abc"))
    with pytest.raises(HTTPException) as exc:
        agents.connect_agent("claude", db, SimpleNamespace(id=uuid.uuid4()))
    assert exc.value.status_code == 409


def test_reconnecting_a_removed_preset_revives_the_same_account():
    removed = _agent(api_token_hash=None)
    removed.deleted_at = datetime.now(timezone.utc)
    db = _agent_db(removed)

    resp = agents.connect_agent("gemini", db, SimpleNamespace(id=uuid.uuid4()))

    db.add.assert_not_called()
    assert removed.deleted_at is None
    assert removed.api_token_hash == agent_service.hash_token(resp.token)


def test_unknown_preset_is_404():
    with pytest.raises(HTTPException) as exc:
        agents.connect_agent("grok", MagicMock(), SimpleNamespace(id=uuid.uuid4()))
    assert exc.value.status_code == 404


def test_removing_an_agent_revokes_its_token():
    agent = _agent(api_token_hash="abc")
    db = _agent_db(agent)

    agents.remove_agent("claude", db, SimpleNamespace(id=uuid.uuid4()))

    assert agent.api_token_hash is None
    assert agent.deleted_at is not None


def test_cli_files_ship_where_the_router_serves_them():
    assert (agents._CLI_DIR / "ffd.py").is_file()
    assert (agents._CLI_DIR / "skills" / "freeframed-review" / "SKILL.md").is_file()
