import uuid
from datetime import datetime, timezone

from sqlalchemy import event
from sqlalchemy.orm import Session

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.routers import folders

from ._folder_scope_support import build_folder_scope_world


def _add_folder(
    db: Session,
    project_id: uuid.UUID,
    creator_id: uuid.UUID,
    name: str,
    parent_id: uuid.UUID | None = None,
) -> Folder:
    folder = Folder(
        project_id=project_id,
        parent_id=parent_id,
        name=name,
        created_by=creator_id,
    )
    db.add(folder)
    db.flush()
    return folder


def _add_asset(
    db: Session,
    project_id: uuid.UUID,
    folder_id: uuid.UUID,
    creator_id: uuid.UUID,
    name: str,
) -> Asset:
    asset = Asset(
        project_id=project_id,
        folder_id=folder_id,
        name=name,
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def _add_owner_membership(db: Session, project_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    db.add(
        ProjectMember(
            project_id=project_id,
            user_id=owner_id,
            role=ProjectRole.owner,
        )
    )
    db.flush()


def test_folder_listing_batching_preserves_item_counts(db, make_project) -> None:
    project, owner = make_project()
    _add_owner_membership(db, project.id, owner.id)
    roots = [
        _add_folder(db, project.id, owner.id, f"Root {index}")
        for index in range(3)
    ]
    _add_folder(db, project.id, owner.id, "Child 0A", roots[0].id)
    _add_folder(db, project.id, owner.id, "Child 0B", roots[0].id)
    _add_asset(db, project.id, roots[0].id, owner.id, "root-0.mov")
    _add_asset(db, project.id, roots[1].id, owner.id, "root-1.mov")
    deleted_child = _add_folder(
        db,
        project.id,
        owner.id,
        "Deleted child",
        roots[0].id,
    )
    deleted_child.deleted_at = datetime.now(timezone.utc)
    deleted_asset = _add_asset(
        db,
        project.id,
        roots[1].id,
        owner.id,
        "deleted.mov",
    )
    deleted_asset.deleted_at = datetime.now(timezone.utc)
    db.flush()

    response = folders.list_folders(
        project.id,
        parent_id="root",
        db=db,
        current_user=owner,
    )

    assert {item.id: item.item_count for item in response} == {
        roots[0].id: 3,
        roots[1].id: 1,
        roots[2].id: 0,
    }


def test_folder_listing_batching_uses_bounded_query_count(
    db,
    migrated_engine,
    make_project,
) -> None:
    project, owner = make_project()
    _add_owner_membership(db, project.id, owner.id)
    roots = [
        _add_folder(db, project.id, owner.id, f"Root {index}")
        for index in range(10)
    ]
    for index, root in enumerate(roots):
        _add_folder(db, project.id, owner.id, f"Child {index}", root.id)
        _add_asset(db, project.id, root.id, owner.id, f"asset-{index}.mov")
    statements: list[str] = []

    def count_statement(
        _conn,
        _cursor,
        statement: str,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        statements.append(statement)

    event.listen(migrated_engine, "before_cursor_execute", count_statement)
    try:
        folders.list_folders(
            project.id,
            parent_id="root",
            db=db,
            current_user=owner,
        )
    finally:
        event.remove(migrated_engine, "before_cursor_execute", count_statement)

    assert len(statements) <= 6


def test_folder_listing_batching_keeps_scoped_counts_scope_filtered(
    db,
    make_project,
    make_user,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    foreign_project, foreign_owner = make_project()
    _add_folder(
        db,
        foreign_project.id,
        foreign_owner.id,
        "Foreign child",
        world.root_a.id,
    )

    response = folders.list_folders(
        world.project.id,
        parent_id="root",
        db=db,
        current_user=world.recipient,
    )

    assert {item.id: item.item_count for item in response} == {
        world.root_a.id: 2,
        world.root_b.id: 2,
    }
