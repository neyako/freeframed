import importlib
import importlib.util
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock

import pytest
from sqlalchemy.exc import InvalidRequestError

from apps.api.models.approval import ApprovalStatus
from apps.api.routers import approvals, share
from apps.api.schemas.approval import ApprovalCreate


def test_approval_service_stages_with_flush_and_never_owns_commit() -> None:
    spec = importlib.util.find_spec("apps.api.services.approval_service")
    assert spec is not None
    approval_service = importlib.import_module("apps.api.services.approval_service")

    asset = MagicMock()
    asset.id = uuid.uuid4()
    version = MagicMock()
    version.id = uuid.uuid4()
    version.asset_id = asset.id
    version.deleted_at = None
    user = MagicMock()
    user.id = uuid.uuid4()
    db = MagicMock()
    version_query = MagicMock()
    approval_query = MagicMock()
    db.query.side_effect = [version_query, approval_query]
    version_query.filter.return_value.first.return_value = version
    approval_query.filter.return_value.first.return_value = None

    approval = approval_service.upsert_approval(
        db,
        asset,
        version.id,
        user,
        ApprovalStatus.approved,
        "Synthetic note",
    )

    assert approval.asset_id == asset.id
    assert approval.version_id == version.id
    assert approval.user_id == user.id
    db.flush.assert_called_once()
    db.commit.assert_not_called()
    db.refresh.assert_not_called()


def _configure_approval_route(monkeypatch, scoped, action, db, actor, asset, creator, approval):
    module = share if scoped else approvals
    monkeypatch.setattr(module, "upsert_approval", lambda *args, **kwargs: approval)
    monkeypatch.setattr(module, "get_workspace_name", lambda _db: "Synthetic workspace")
    monkeypatch.setattr(module, "send_task_safe", MagicMock())
    db.query.return_value.filter.return_value.first.return_value = creator
    if scoped:
        monkeypatch.setattr(module, "_validate_secure_approval_link", lambda *args: (MagicMock(), actor))
        monkeypatch.setattr(module, "_get_asset", lambda *args: asset)
        monkeypatch.setattr(module, "validate_asset_in_share", lambda *args: None)
        return module.approve_shared_asset if action == "approve" else module.reject_shared_asset
    monkeypatch.setattr(module, "_get_asset", lambda *args: asset)
    monkeypatch.setattr(module, "get_asset_access", lambda *args: SimpleNamespace(can_approve=True))
    return module.approve_asset if action == "approve" else module.reject_asset


def _read_before_commit(expired: list[bool], value: str) -> str:
    if expired[0]:
        raise InvalidRequestError("expired")
    return value


@pytest.mark.parametrize("scoped", [False, True])
@pytest.mark.parametrize("action", ["approve", "reject"])
def test_approval_routes_capture_email_scalars_before_commit(monkeypatch, scoped, action) -> None:
    expired = [False]
    actor = MagicMock(id=uuid.uuid4(), email="reviewer@example.invalid")
    asset = MagicMock(id=uuid.uuid4(), created_by=uuid.uuid4())
    creator = MagicMock(id=asset.created_by)
    type(actor).name = PropertyMock(side_effect=lambda: _read_before_commit(expired, "Reviewer"))
    type(asset).name = PropertyMock(side_effect=lambda: _read_before_commit(expired, "Asset"))
    type(creator).email = PropertyMock(side_effect=lambda: _read_before_commit(expired, "creator@example.invalid"))
    db = MagicMock()
    db.commit.side_effect = lambda: expired.__setitem__(0, True)
    approval = MagicMock()
    route = _configure_approval_route(monkeypatch, scoped, action, db, actor, asset, creator, approval)
    body = ApprovalCreate(version_id=uuid.uuid4(), note="Synthetic note")

    result = route(uuid.uuid4().hex, asset.id, body, None, db, actor) if scoped else route(asset.id, body, db, actor)

    assert result is approval


@pytest.mark.parametrize("scoped", [False, True])
@pytest.mark.parametrize("action", ["approve", "reject"])
def test_committed_approval_survives_dispatch_start_failure(monkeypatch, scoped, action) -> None:
    actor = SimpleNamespace(id=uuid.uuid4(), name="Reviewer", email="reviewer@example.invalid")
    asset = SimpleNamespace(id=uuid.uuid4(), name="Asset", created_by=uuid.uuid4())
    creator = SimpleNamespace(id=asset.created_by, email="creator@example.invalid")
    db = MagicMock()
    approval = MagicMock()
    route = _configure_approval_route(monkeypatch, scoped, action, db, actor, asset, creator, approval)
    (share if scoped else approvals).send_task_safe.side_effect = RuntimeError("thread start failed")
    body = ApprovalCreate(version_id=uuid.uuid4(), note="Synthetic note")

    result = route(uuid.uuid4().hex, asset.id, body, None, db, actor) if scoped else route(asset.id, body, db, actor)

    db.commit.assert_called_once()
    assert result is approval
