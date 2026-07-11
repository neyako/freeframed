from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier, local
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, sessionmaker

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.user import User
from apps.api.routers import folders
from apps.api.schemas.folder import BulkMoveRequest, FolderUpdate


@dataclass(frozen=True, slots=True)
class Graph:
    project: Project
    owner: User
    root: Folder
    parent: Folder
    child: Folder
    sibling: Folder
    asset: Asset


def _folder(db: Session, project: Project, name: str, parent: Folder | None = None) -> Folder:
    folder = Folder(
        project_id=project.id,
        parent_id=parent.id if parent else None,
        name=f"{name}-{uuid.uuid4().hex}",
        created_by=project.created_by,
    )
    db.add(folder)
    db.flush()
    return folder


def _graph(db: Session, make_project) -> Graph:
    project, owner = make_project()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role=ProjectRole.owner))
    root = _folder(db, project, "root")
    parent = _folder(db, project, "parent", root)
    child = _folder(db, project, "child", parent)
    sibling = _folder(db, project, "sibling", root)
    asset = Asset(
        project_id=project.id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=owner.id,
        folder_id=parent.id,
    )
    db.add(asset)
    db.flush()
    return Graph(project, owner, root, parent, child, sibling, asset)


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


@pytest.mark.parametrize("cross_path", [False, True])
def test_opposite_hierarchy_moves_serialize(cross_path: bool, db, make_project, monkeypatch) -> None:
    # Given
    graph = _graph(db, make_project)
    db.commit()
    barrier = Barrier(2)
    thread_state = local()
    original = folders._get_descendant_ids

    def note_lock(conn, cursor, statement, parameters, context, executemany) -> None:
        if "FOR UPDATE" in statement.upper() and "FROM projects" in statement:
            thread_state.project_locked = True

    def align_unlocked(session: Session, folder_id: uuid.UUID) -> list[uuid.UUID]:
        result = original(session, folder_id)
        if not getattr(thread_state, "project_locked", False):
            barrier.wait(timeout=10)
        return result

    event.listen(db.get_bind(), "before_cursor_execute", note_lock)
    monkeypatch.setattr(folders, "_get_descendant_ids", align_unlocked)
    factory = sessionmaker(bind=db.get_bind())

    def move(source: uuid.UUID, target: uuid.UUID, use_patch: bool) -> int:
        thread_state.project_locked = False
        with factory() as session:
            try:
                if use_patch:
                    folders.update_folder(source, FolderUpdate(parent_id=target), session, graph.owner)
                else:
                    folders.bulk_move(
                        graph.project.id,
                        BulkMoveRequest(folder_ids=[source], target_folder_id=target),
                        session,
                        graph.owner,
                    )
            except HTTPException as error:
                return error.status_code
        return 200

    # When
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(move, graph.parent.id, graph.sibling.id, cross_path)
        second = executor.submit(move, graph.sibling.id, graph.parent.id, False)
        statuses = sorted([first.result(timeout=20), second.result(timeout=20)])
    event.remove(db.get_bind(), "before_cursor_execute", note_lock)

    # Then
    assert statuses == [200, 400]


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
