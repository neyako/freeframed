import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset
from apps.api.models.folder import Folder
from apps.api.models.share import ShareLinkItem
from apps.api.routers import share


def _multi_share_browse_db(
    *,
    project_id: uuid.UUID,
    selected_folder_id: uuid.UUID,
    requested_folder_id: uuid.UUID,
) -> MagicMock:
    db = MagicMock()

    link_items_query = MagicMock()
    link_items_query.filter.return_value = link_items_query
    link_items_query.all.return_value = [
        SimpleNamespace(asset_id=None, folder_id=selected_folder_id),
    ]

    folder_query = MagicMock()
    folder_query.filter.return_value = folder_query
    folder_query.order_by.return_value = folder_query
    folder_query.first.return_value = SimpleNamespace(
        id=requested_folder_id,
        project_id=project_id,
    )
    folder_query.all.return_value = []

    asset_query = MagicMock()
    asset_query.filter.return_value = asset_query
    asset_query.order_by.return_value = asset_query
    asset_query.offset.return_value = asset_query
    asset_query.limit.return_value = asset_query
    asset_query.all.return_value = []

    count_query = MagicMock()
    count_query.filter.return_value = count_query
    count_query.scalar.return_value = 0

    def query(model):
        if model is ShareLinkItem:
            return link_items_query
        if model is Folder:
            return folder_query
        if model is Asset:
            return asset_query
        return count_query

    db.query.side_effect = query
    return db


def _browse_multi_share_folder(
    monkeypatch,
    *,
    selected_folder_id: uuid.UUID,
    requested_folder_id: uuid.UUID,
    is_descendant: bool,
):
    project_id = uuid.uuid4()
    link = SimpleNamespace(
        id=uuid.uuid4(),
        project_id=project_id,
        folder_id=None,
    )
    db = _multi_share_browse_db(
        project_id=project_id,
        selected_folder_id=selected_folder_id,
        requested_folder_id=requested_folder_id,
    )
    monkeypatch.setattr(
        share,
        "validate_share_link_with_session",
        lambda *_args, **_kwargs: link,
    )
    monkeypatch.setattr(
        share,
        "_is_active_descendant_of",
        lambda *_args: is_descendant,
    )

    return share.get_folder_share_assets(
        token="multi-token",
        folder_id=requested_folder_id,
        share_session=None,
        db=db,
        current_user=None,
    )


def test_multi_share_rejects_non_selected_folder(monkeypatch) -> None:
    selected_folder_id = uuid.uuid4()

    with pytest.raises(HTTPException) as exc_info:
        _browse_multi_share_folder(
            monkeypatch,
            selected_folder_id=selected_folder_id,
            requested_folder_id=uuid.uuid4(),
            is_descendant=False,
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Folder is not within the shared items"


def test_multi_share_allows_selected_folder(monkeypatch) -> None:
    selected_folder_id = uuid.uuid4()

    response = _browse_multi_share_folder(
        monkeypatch,
        selected_folder_id=selected_folder_id,
        requested_folder_id=selected_folder_id,
        is_descendant=False,
    )

    assert response.total == 0


def test_multi_share_allows_descendant_of_selected_folder(monkeypatch) -> None:
    response = _browse_multi_share_folder(
        monkeypatch,
        selected_folder_id=uuid.uuid4(),
        requested_folder_id=uuid.uuid4(),
        is_descendant=True,
    )

    assert response.total == 0


def test_project_direct_share_rejects_comment_permission(
    client,
    auth_headers,
) -> None:
    response = client.post(
        f"/projects/{uuid.uuid4()}/share/user",
        json={"email": "reviewer@example.com", "permission": "comment"},
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Project shares support view or approve permission"
