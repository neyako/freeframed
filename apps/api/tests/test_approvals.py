import importlib
import importlib.util
import uuid
from unittest.mock import MagicMock

from apps.api.models.approval import ApprovalStatus


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
