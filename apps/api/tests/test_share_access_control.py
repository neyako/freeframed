import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from apps.api.routers import share


def _browse_db() -> MagicMock:
    db = MagicMock()
    query = MagicMock()
    for method in ("filter", "order_by", "offset", "limit", "group_by"):
        getattr(query, method).return_value = query
    query.all.return_value = []
    query.scalar.return_value = 0
    db.query.return_value = query
    return db


def _browse_folder_share(monkeypatch, *, requested_folder_id: uuid.UUID, is_descendant: bool):
    link = SimpleNamespace(id=uuid.uuid4(), asset_id=None, folder_id=uuid.uuid4())
    monkeypatch.setattr(share, "validate_share_link_with_session", lambda *_args, **_kwargs: link)
    monkeypatch.setattr(share, "_is_active_descendant_of", lambda *_args: is_descendant)
    return share.get_folder_share_assets(
        token="folder-token",
        folder_id=requested_folder_id,
        share_session=None,
        db=_browse_db(),
        current_user=None,
    )


def test_folder_share_rejects_folder_outside_shared_tree(monkeypatch) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _browse_folder_share(monkeypatch, requested_folder_id=uuid.uuid4(), is_descendant=False)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Folder is not within the shared folder"


def test_folder_share_allows_descendant_folder(monkeypatch) -> None:
    response = _browse_folder_share(monkeypatch, requested_folder_id=uuid.uuid4(), is_descendant=True)

    assert response.total == 0


def test_asset_share_link_cannot_browse_folders(monkeypatch) -> None:
    link = SimpleNamespace(id=uuid.uuid4(), asset_id=uuid.uuid4(), folder_id=None)
    monkeypatch.setattr(share, "validate_share_link_with_session", lambda *_args, **_kwargs: link)

    with pytest.raises(HTTPException) as exc_info:
        share.get_folder_share_assets(
            token="asset-token",
            folder_id=None,
            share_session=None,
            db=_browse_db(),
            current_user=None,
        )

    assert exc_info.value.status_code == 400
