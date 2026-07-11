from datetime import datetime, timezone
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from apps.api.models.asset import Asset
from apps.api.models.folder import Folder
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.routers import folders
from apps.api.schemas.folder import BulkMoveRequest, FolderUpdate
from apps.api.tests.integration._folder_hierarchy_support import folder as _folder
from apps.api.tests.integration._folder_hierarchy_support import graph as _graph


def test_characterization_patch_rejects_self_and_descendant_without_state_change(db, make_project) -> None:
    # Given
    graph = _graph(db, make_project)
    original_parent = graph.parent.parent_id

    # When
    with pytest.raises(HTTPException) as caught:
        folders.update_folder(graph.parent.id, FolderUpdate(parent_id=graph.child.id), db, graph.owner)

    # Then
    assert caught.value.status_code == 400
    assert graph.parent.parent_id == original_parent


@pytest.mark.parametrize("target", ["sibling", "root"])
def test_characterization_patch_allows_sibling_and_root(db, make_project, target: str) -> None:
    # Given
    graph = _graph(db, make_project)
    target_id = graph.sibling.id if target == "sibling" else None

    # When
    response = folders.update_folder(
        graph.child.id,
        FolderUpdate(parent_id=target_id),
        db,
        graph.owner,
    )

    # Then
    assert response.parent_id == target_id
    assert graph.child.parent_id == target_id


def test_characterization_asset_only_bulk_move_succeeds(db, make_project) -> None:
    # Given
    graph = _graph(db, make_project)

    # When
    response = folders.bulk_move(
        graph.project.id,
        BulkMoveRequest(asset_ids=[graph.asset.id], target_folder_id=graph.sibling.id),
        db,
        graph.owner,
    )

    # Then
    assert response == {"ok": True, "moved_assets": 1, "moved_folders": 0}
    assert graph.asset.folder_id == graph.sibling.id


def test_characterization_sibling_folder_and_asset_bulk_move_succeeds(db, make_project) -> None:
    # Given
    graph = _graph(db, make_project)

    # When
    response = folders.bulk_move(
        graph.project.id,
        BulkMoveRequest(
            asset_ids=[graph.asset.id],
            folder_ids=[graph.child.id],
            target_folder_id=graph.sibling.id,
        ),
        db,
        graph.owner,
    )

    # Then
    assert response == {"ok": True, "moved_assets": 1, "moved_folders": 1}
    assert graph.asset.folder_id == graph.sibling.id
    assert graph.child.parent_id == graph.sibling.id


@pytest.mark.parametrize("invalid", ["missing", "deleted", "foreign_target", "foreign_object"])
def test_characterization_invalid_bulk_items_do_not_commit(db, make_project, invalid: str) -> None:
    # Given
    graph = _graph(db, make_project)
    foreign, foreign_owner = make_project()
    db.add(ProjectMember(project_id=foreign.id, user_id=foreign_owner.id, role=ProjectRole.owner))
    foreign_folder = _folder(db, foreign, "foreign")
    target_id = graph.sibling.id
    folder_ids = [graph.child.id]
    if invalid == "missing":
        folder_ids = [uuid.uuid4()]
    elif invalid == "deleted":
        graph.child.deleted_at = datetime.now(timezone.utc)
    elif invalid == "foreign_target":
        target_id = foreign_folder.id
    else:
        folder_ids = [foreign_folder.id]
    db.commit()
    original_parent = graph.child.parent_id
    original_asset_folder = graph.asset.folder_id

    # When
    with pytest.raises(HTTPException):
        folders.bulk_move(
            graph.project.id,
            BulkMoveRequest(
                asset_ids=[graph.asset.id],
                folder_ids=folder_ids,
                target_folder_id=target_id,
            ),
            db,
            graph.owner,
        )

    # Then
    with Session(db.get_bind()) as observer:
        stored_child = observer.get(Folder, graph.child.id)
        stored_asset = observer.get(Asset, graph.asset.id)
        assert stored_child is not None and stored_asset is not None
        assert stored_child.parent_id == original_parent
        assert stored_asset.folder_id == original_asset_folder


def test_bulk_parent_to_child_rejects_without_writes(db, make_project) -> None:
    # Given
    graph = _graph(db, make_project)
    original_parent = graph.parent.parent_id

    # When
    with pytest.raises(HTTPException) as caught:
        folders.bulk_move(
            graph.project.id,
            BulkMoveRequest(folder_ids=[graph.parent.id], target_folder_id=graph.child.id),
            db,
            graph.owner,
        )

    # Then
    assert caught.value.status_code == 400
    assert graph.parent.parent_id == original_parent


@pytest.mark.parametrize("target", ["ancestor", "existing_parent"])
def test_bulk_child_to_ancestor_and_existing_parent_succeed(db, make_project, target: str) -> None:
    # Given
    graph = _graph(db, make_project)
    target_id = graph.root.id if target == "ancestor" else graph.parent.id

    # When
    response = folders.bulk_move(
        graph.project.id,
        BulkMoveRequest(folder_ids=[graph.child.id], target_folder_id=target_id),
        db,
        graph.owner,
    )

    # Then
    assert response["moved_folders"] == 1
    assert graph.child.parent_id == target_id


@pytest.mark.parametrize("subtree", [False, True])
def test_bulk_rejects_resulting_depth_eleven(db, make_project, subtree: bool) -> None:
    # Given
    graph = _graph(db, make_project)
    target = graph.root
    for index in range(8 if subtree else 9):
        target = _folder(db, graph.project, f"depth-{index}", target)
    moved = _folder(db, graph.project, "moved")
    if subtree:
        _folder(db, graph.project, "moved-child", moved)
    original_parent = moved.parent_id

    # When
    with pytest.raises(HTTPException) as caught:
        folders.bulk_move(
            graph.project.id,
            BulkMoveRequest(folder_ids=[moved.id], target_folder_id=target.id),
            db,
            graph.owner,
        )

    # Then
    assert caught.value.status_code == 400
    assert moved.parent_id == original_parent


@pytest.mark.parametrize("invalid_kind", ["folder", "asset"])
def test_mixed_invalid_batch_leaves_orm_histories_unchanged(db, make_project, invalid_kind: str) -> None:
    # Given
    graph = _graph(db, make_project)
    asset_ids = [graph.asset.id] if invalid_kind == "folder" else [uuid.uuid4()]
    folder_ids = [uuid.uuid4()] if invalid_kind == "folder" else [graph.child.id]

    # When
    with db.no_autoflush, pytest.raises(HTTPException):
        folders.bulk_move(
            graph.project.id,
            BulkMoveRequest(asset_ids=asset_ids, folder_ids=folder_ids, target_folder_id=graph.sibling.id),
            db,
            graph.owner,
        )

    # Then
    assert not inspect(graph.asset).attrs.folder_id.history.has_changes()
    assert not inspect(graph.child).attrs.parent_id.history.has_changes()


def test_restore_deleted_cycle_returns_conflict_without_mutation(db, make_project) -> None:
    # Given
    graph = _graph(db, make_project)
    deleted_at = datetime.now(timezone.utc)
    graph.parent.parent_id = graph.child.id
    graph.parent.deleted_at = deleted_at
    graph.child.deleted_at = deleted_at
    db.commit()

    # When
    with pytest.raises(HTTPException) as caught:
        folders.restore_folder(graph.parent.id, db, graph.owner)

    # Then
    assert caught.value.status_code == 409
    assert not inspect(graph.parent).attrs.parent_id.history.has_changes() and not inspect(graph.parent).attrs.deleted_at.history.has_changes()


def test_patch_active_cycle_to_root_returns_conflict_without_mutation(db, make_project) -> None:
    # Given
    graph = _graph(db, make_project)
    graph.parent.parent_id = graph.child.id
    db.commit()

    # When
    with pytest.raises(HTTPException) as caught:
        folders.update_folder(graph.parent.id, FolderUpdate(parent_id=None), db, graph.owner)

    # Then
    assert caught.value.status_code == 409
    assert not inspect(graph.parent).attrs.parent_id.history.has_changes()
