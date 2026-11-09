"""A taken subfolder name is a 409 with a readable message, not the unique index's 500."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.folder import Folder
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.routers import folders
from apps.api.schemas.folder import BulkMoveRequest, FolderCreate, FolderUpdate


@pytest.fixture
def world(db, make_project):
    project, owner = make_project()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role=ProjectRole.owner))
    db.flush()
    return project, owner


def _folder(db, project, owner, name, parent=None) -> Folder:
    row = Folder(project_id=project.id, parent_id=parent.id if parent else None, name=name, created_by=owner.id)
    db.add(row)
    db.flush()
    return row


def _create(db, owner, project, name, parent=None):
    return folders.create_folder(
        project.id, FolderCreate(name=name, parent_id=parent.id if parent else None), db, owner,
    )


def test_creating_a_duplicate_subfolder_is_refused_with_the_name_in_the_message(db, world):
    project, owner = world
    parent = _folder(db, project, owner, "Footage")
    _create(db, owner, project, "Day 1", parent)

    with pytest.raises(HTTPException) as caught:
        _create(db, owner, project, "Day 1", parent)

    assert caught.value.status_code == 409
    assert "Day 1" in caught.value.detail


def test_the_same_name_is_fine_elsewhere_after_a_trash_and_at_the_root(db, world):
    project, owner = world
    a = _folder(db, project, owner, "A")
    b = _folder(db, project, owner, "B")
    first = _create(db, owner, project, "Day 1", a)

    _create(db, owner, project, "Day 1", b)  # different parent

    first_row = db.get(Folder, first.id)
    first_row.deleted_at = datetime.now(timezone.utc)  # trashed folders free their name
    db.flush()
    _create(db, owner, project, "Day 1", a)

    _create(db, owner, project, "Reels")  # root level is not covered by the index
    _create(db, owner, project, "Reels")


def test_renaming_or_moving_onto_a_taken_name_is_refused(db, world):
    project, owner = world
    parent = _folder(db, project, owner, "Footage")
    other = _folder(db, project, owner, "Archive")
    _folder(db, project, owner, "Day 1", parent)
    renamed = _folder(db, project, owner, "Day 2", parent)
    moving = _folder(db, project, owner, "Day 1", other)

    with pytest.raises(HTTPException) as rename:
        folders.update_folder(renamed.id, FolderUpdate(name="Day 1"), db, owner)
    with pytest.raises(HTTPException) as move:
        folders.update_folder(moving.id, FolderUpdate(parent_id=parent.id), db, owner)

    assert rename.value.status_code == move.value.status_code == 409
    assert renamed.name == "Day 2"
    assert moving.parent_id == other.id


def test_a_rename_that_keeps_its_own_name_is_not_a_conflict(db, world):
    project, owner = world
    parent = _folder(db, project, owner, "Footage")
    child = _folder(db, project, owner, "Day 1", parent)

    assert folders.update_folder(child.id, FolderUpdate(name="Day 1"), db, owner).name == "Day 1"


def test_bulk_move_refuses_a_collision_with_the_target_or_within_the_selection(db, world):
    project, owner = world
    target = _folder(db, project, owner, "Target")
    _folder(db, project, owner, "Cuts", target)
    taken = _folder(db, project, owner, "Cuts")
    twin_a = _folder(db, project, owner, "Twin")
    holder = _folder(db, project, owner, "Holder")
    twin_b = _folder(db, project, owner, "Twin", holder)

    with pytest.raises(HTTPException) as into_target:
        folders.bulk_move(
            project.id, BulkMoveRequest(asset_ids=[], folder_ids=[taken.id], target_folder_id=target.id), db, owner,
        )
    with pytest.raises(HTTPException) as together:
        folders.bulk_move(
            project.id,
            BulkMoveRequest(asset_ids=[], folder_ids=[twin_a.id, twin_b.id], target_folder_id=target.id),
            db,
            owner,
        )

    assert into_target.value.status_code == together.value.status_code == 409


def test_restoring_a_folder_whose_name_was_taken_meanwhile_is_refused(db, world):
    project, owner = world
    parent = _folder(db, project, owner, "Footage")
    trashed = _folder(db, project, owner, "Day 1", parent)
    trashed.deleted_at = datetime.now(timezone.utc)
    db.flush()
    _create(db, owner, project, "Day 1", parent)  # takes the freed name

    with pytest.raises(HTTPException) as caught:
        folders.restore_folder(trashed.id, db, owner)

    assert caught.value.status_code == 409
    assert db.get(Folder, trashed.id).deleted_at is not None
