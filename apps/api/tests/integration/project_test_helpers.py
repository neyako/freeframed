import uuid

from sqlalchemy.orm import Session

from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.user import User


def _member(project: Project, user: User, role: ProjectRole) -> ProjectMember:
    return ProjectMember(project_id=project.id, user_id=user.id, role=role)


def _project_with_owner(db: Session, user: User) -> Project:
    project = Project(name="Project", created_by=user.id)
    db.add(project)
    db.flush()
    db.add(_member(project, user, ProjectRole.owner))
    db.flush()
    return project


def _active_owner_ids(db: Session, project_id: uuid.UUID) -> set[uuid.UUID]:
    rows = db.query(ProjectMember.user_id).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.role == ProjectRole.owner,
        ProjectMember.deleted_at.is_(None),
    ).all()
    return {row[0] for row in rows}
