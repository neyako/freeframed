from __future__ import annotations

from dataclasses import dataclass
import uuid

from fastapi import HTTPException, status
from sqlalchemy import Select, any_, func, literal, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.orm import Session, aliased

from ..models.folder import Folder
from ..models.project import Project
from ..models.share import AssetShare, SharePermission

MAX_FOLDER_DEPTH = 10
FOLDER_CYCLE_DETAIL = "Folder hierarchy contains a cycle"
FOLDER_DEPTH_DETAIL = "Folder hierarchy exceeds maximum depth of 10"


@dataclass(frozen=True, slots=True)
class FolderGrant:
    folder_id: uuid.UUID
    permission: SharePermission


@dataclass(frozen=True, slots=True)
class FolderAccess:
    accessible_root_ids: tuple[uuid.UUID, ...]
    grants: tuple[FolderGrant, ...]


def _grant_hierarchy(project_id: uuid.UUID, user_id: uuid.UUID):
    seed = (
        select(
            literal("ancestor").label("direction"),
            AssetShare.folder_id.label("grant_id"),
            Folder.id.label("folder_id"),
            Folder.parent_id.label("parent_id"),
            array([Folder.id]).label("path"),
            literal(1).label("depth"),
            literal(False).label("cycle"),
        )
        .join(Folder, Folder.id == AssetShare.folder_id)
        .join(Project, Project.id == Folder.project_id)
        .where(
            Project.id == project_id,
            Project.deleted_at.is_(None),
            Folder.project_id == project_id,
            Folder.deleted_at.is_(None),
            AssetShare.shared_with_user_id == user_id,
            AssetShare.folder_id.is_not(None),
            AssetShare.deleted_at.is_(None),
        )
        .distinct()
    )
    ancestors = seed.cte("folder_grant_ancestors", recursive=True)
    parent = aliased(Folder)
    ancestors = ancestors.union_all(
        select(
            literal("ancestor"),
            ancestors.c.grant_id,
            parent.id,
            parent.parent_id,
            ancestors.c.path + array([parent.id]),
            ancestors.c.depth + 1,
            parent.id == any_(ancestors.c.path),
        )
        .join(parent, parent.id == ancestors.c.parent_id)
        .where(
            parent.project_id == project_id,
            parent.deleted_at.is_(None),
            ancestors.c.cycle.is_(False),
            ancestors.c.depth <= MAX_FOLDER_DEPTH,
        )
    )

    grant_depths = (
        select(
            ancestors.c.grant_id,
            func.max(ancestors.c.depth).label("depth"),
        )
        .where(ancestors.c.cycle.is_(False))
        .group_by(ancestors.c.grant_id)
        .subquery()
    )
    grant_folder = aliased(Folder)
    descendant_seed = (
        select(
            literal("descendant").label("direction"),
            grant_folder.id.label("grant_id"),
            grant_folder.id.label("folder_id"),
            grant_folder.parent_id.label("parent_id"),
            array([grant_folder.id]).label("path"),
            grant_depths.c.depth.label("depth"),
            literal(False).label("cycle"),
        )
        .join(grant_depths, grant_depths.c.grant_id == grant_folder.id)
        .where(
            grant_folder.project_id == project_id,
            grant_folder.deleted_at.is_(None),
        )
    )
    descendants = descendant_seed.cte("folder_grant_descendants", recursive=True)
    child = aliased(Folder)
    descendants = descendants.union_all(
        select(
            literal("descendant"),
            descendants.c.grant_id,
            child.id,
            child.parent_id,
            descendants.c.path + array([child.id]),
            descendants.c.depth + 1,
            child.id == any_(descendants.c.path),
        )
        .join(child, child.parent_id == descendants.c.folder_id)
        .where(
            child.project_id == project_id,
            child.deleted_at.is_(None),
            descendants.c.cycle.is_(False),
            descendants.c.depth <= MAX_FOLDER_DEPTH,
        )
    )
    return select(
        ancestors.c.direction,
        ancestors.c.grant_id,
        ancestors.c.folder_id,
        ancestors.c.depth,
        ancestors.c.cycle,
    ).union_all(
        select(
            descendants.c.direction,
            descendants.c.grant_id,
            descendants.c.folder_id,
            descendants.c.depth,
            descendants.c.cycle,
        )
    )


def resolve_folder_access(
    db: Session,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
) -> FolderAccess | None:
    rows = (
        db.query(AssetShare.folder_id, AssetShare.permission)
        .join(Folder, Folder.id == AssetShare.folder_id)
        .join(Project, Project.id == Folder.project_id)
        .filter(
            Project.id == project_id,
            Project.deleted_at.is_(None),
            Folder.project_id == project_id,
            Folder.deleted_at.is_(None),
            AssetShare.shared_with_user_id == user_id,
            AssetShare.folder_id.isnot(None),
            AssetShare.deleted_at.is_(None),
        )
        .order_by(Folder.created_at, Folder.id)
        .all()
    )
    grants = tuple(FolderGrant(row.folder_id, row.permission) for row in rows)
    if not grants:
        return None

    granted_ids = {grant.folder_id for grant in grants}
    hierarchy_rows = db.execute(_grant_hierarchy(project_id, user_id)).all()
    if any(row.cycle for row in hierarchy_rows):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FOLDER_CYCLE_DETAIL,
        )
    if any(row.depth > MAX_FOLDER_DEPTH for row in hierarchy_rows):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=FOLDER_DEPTH_DETAIL,
        )
    nested_ids = {
        row.grant_id
        for row in hierarchy_rows
        if row.direction == "ancestor"
        and row.folder_id != row.grant_id
        and row.folder_id in granted_ids
    }
    roots = tuple(dict.fromkeys(
        grant.folder_id for grant in grants if grant.folder_id not in nested_ids
    ))
    return FolderAccess(accessible_root_ids=roots, grants=grants)


def folder_scope_select(
    project_id: uuid.UUID,
    root_ids: tuple[uuid.UUID, ...],
) -> Select[tuple[uuid.UUID]]:
    seed = select(Folder.id.label("id")).where(
        Folder.project_id == project_id,
        Folder.id.in_(root_ids),
        Folder.deleted_at.is_(None),
    )
    scope = seed.cte("folder_access_scope", recursive=True)
    child = aliased(Folder)
    scope = scope.union(
        select(child.id)
        .join(scope, child.parent_id == scope.c.id)
        .where(child.project_id == project_id, child.deleted_at.is_(None))
    )
    return select(scope.c.id)


def folder_is_in_scope(
    db: Session,
    project_id: uuid.UUID,
    folder_id: uuid.UUID,
    access: FolderAccess,
) -> bool:
    return db.query(Folder.id).filter(
        Folder.project_id == project_id,
        Folder.id == folder_id,
        Folder.deleted_at.is_(None),
        Folder.id.in_(folder_scope_select(project_id, access.accessible_root_ids)),
    ).first() is not None
