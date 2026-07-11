from dataclasses import dataclass
import uuid

from sqlalchemy.orm import Session

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.user import User


@dataclass(frozen=True, slots=True)
class Graph:
    project: Project
    owner: User
    root: Folder
    parent: Folder
    child: Folder
    sibling: Folder
    asset: Asset


def folder(db: Session, project: Project, name: str, parent: Folder | None = None) -> Folder:
    result = Folder(
        project_id=project.id,
        parent_id=parent.id if parent else None,
        name=f"{name}-{uuid.uuid4().hex}",
        created_by=project.created_by,
    )
    db.add(result)
    db.flush()
    return result


def graph(db: Session, make_project) -> Graph:
    project, owner = make_project()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role=ProjectRole.owner))
    root = folder(db, project, "root")
    parent = folder(db, project, "parent", root)
    child = folder(db, project, "child", parent)
    sibling = folder(db, project, "sibling", root)
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


def hierarchy_truth(db: Session, project_id: uuid.UUID) -> tuple[bool, int]:
    rows = db.query(Folder.id, Folder.parent_id).filter(
        Folder.project_id == project_id,
        Folder.deleted_at.is_(None),
    ).all()
    parents = dict(rows)
    maximum_depth = 0
    for folder_id in parents:
        visited: set[uuid.UUID] = set()
        current_id: uuid.UUID | None = folder_id
        depth = 0
        while current_id is not None and current_id in parents:
            if current_id in visited:
                return False, maximum_depth
            visited.add(current_id)
            depth += 1
            current_id = parents[current_id]
        maximum_depth = max(maximum_depth, depth)
    return True, maximum_depth
