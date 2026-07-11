from datetime import datetime, timezone
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.routers import folders
from apps.api.schemas.folder import BulkMoveRequest
from apps.api.tests.integration._folder_hierarchy_support import folder, graph, hierarchy_truth


def test_bulk_move_to_root_succeeds_with_sql_truth(db, make_project) -> None:
    # Given
    seeded = graph(db, make_project)
    db.commit()

    # When
    response = folders.bulk_move(
        seeded.project.id,
        BulkMoveRequest(folder_ids=[seeded.child.id], target_folder_id=None),
        db,
        seeded.owner,
    )

    # Then
    with Session(db.get_bind()) as observer:
        stored = observer.get(Folder, seeded.child.id)
        assert response == {"ok": True, "moved_assets": 0, "moved_folders": 1}
        assert stored is not None and stored.parent_id is None


def test_bulk_move_resulting_depth_ten_succeeds(db, make_project) -> None:
    # Given
    seeded = graph(db, make_project)
    target = seeded.root
    for index in range(8):
        target = folder(db, seeded.project, f"depth-{index}", target)
    moved = folder(db, seeded.project, "moved")

    # When
    response = folders.bulk_move(
        seeded.project.id,
        BulkMoveRequest(folder_ids=[moved.id], target_folder_id=target.id),
        db,
        seeded.owner,
    )

    # Then
    acyclic, maximum_depth = hierarchy_truth(db, seeded.project.id)
    assert response["moved_folders"] == 1
    assert moved.parent_id == target.id
    assert acyclic and maximum_depth == 10


def test_nested_selected_roots_become_siblings_under_target(db, make_project) -> None:
    # Given
    seeded = graph(db, make_project)

    # When
    response = folders.bulk_move(
        seeded.project.id,
        BulkMoveRequest(
            folder_ids=[seeded.parent.id, seeded.child.id],
            target_folder_id=seeded.sibling.id,
        ),
        db,
        seeded.owner,
    )

    # Then
    db.refresh(seeded.parent)
    db.refresh(seeded.child)
    assert response["moved_folders"] == 2
    assert seeded.parent.parent_id == seeded.sibling.id
    assert seeded.child.parent_id == seeded.sibling.id


@pytest.mark.parametrize("invalid", ["deleted_target", "deleted_asset", "foreign_asset"])
def test_bulk_invalid_target_or_asset_leaves_sql_unchanged(db, make_project, invalid: str) -> None:
    # Given
    seeded = graph(db, make_project)
    target_id = seeded.sibling.id
    asset_id = seeded.asset.id
    expected_status = 400
    if invalid == "deleted_target":
        seeded.sibling.deleted_at = datetime.now(timezone.utc)
        expected_status = 404
    elif invalid == "deleted_asset":
        seeded.asset.deleted_at = datetime.now(timezone.utc)
    else:
        foreign, foreign_owner = make_project()
        db.add(ProjectMember(project_id=foreign.id, user_id=foreign_owner.id, role=ProjectRole.owner))
        foreign_asset = Asset(
            project_id=foreign.id,
            name="foreign.mov",
            asset_type=AssetType.video,
            created_by=foreign_owner.id,
        )
        db.add(foreign_asset)
        db.flush()
        asset_id = foreign_asset.id
    db.commit()
    original_parent = seeded.child.parent_id
    original_asset_folder = seeded.asset.folder_id

    # When
    with pytest.raises(HTTPException) as caught:
        folders.bulk_move(
            seeded.project.id,
            BulkMoveRequest(
                asset_ids=[asset_id],
                folder_ids=[seeded.child.id],
                target_folder_id=target_id,
            ),
            db,
            seeded.owner,
        )

    # Then
    with Session(db.get_bind()) as observer:
        stored_folder = observer.get(Folder, seeded.child.id)
        stored_asset = observer.get(Asset, seeded.asset.id)
        assert caught.value.status_code == expected_status
        assert stored_folder is not None and stored_folder.parent_id == original_parent
        assert stored_asset is not None and stored_asset.folder_id == original_asset_folder


@pytest.mark.parametrize("invalid_kind", ["folder", "asset"])
def test_mixed_invalid_orders_leave_sql_and_histories_unchanged(db, make_project, invalid_kind: str) -> None:
    # Given
    seeded = graph(db, make_project)
    asset_ids = [seeded.asset.id] if invalid_kind == "folder" else [uuid.uuid4()]
    folder_ids = [uuid.uuid4()] if invalid_kind == "folder" else [seeded.child.id]
    db.commit()
    original_parent = seeded.child.parent_id
    original_asset_folder = seeded.asset.folder_id

    # When
    with db.no_autoflush, pytest.raises(HTTPException):
        folders.bulk_move(
            seeded.project.id,
            BulkMoveRequest(
                asset_ids=asset_ids,
                folder_ids=folder_ids,
                target_folder_id=seeded.sibling.id,
            ),
            db,
            seeded.owner,
        )

    # Then
    assert not inspect(seeded.asset).attrs.folder_id.history.has_changes()
    assert not inspect(seeded.child).attrs.parent_id.history.has_changes()
    with Session(db.get_bind()) as observer:
        stored_folder = observer.get(Folder, seeded.child.id)
        stored_asset = observer.get(Asset, seeded.asset.id)
        assert stored_folder is not None and stored_folder.parent_id == original_parent
        assert stored_asset is not None and stored_asset.folder_id == original_asset_folder
