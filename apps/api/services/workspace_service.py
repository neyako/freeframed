from sqlalchemy.orm import Session

from ..models.branding import WorkspaceSettings


DEFAULT_WORKSPACE_NAME = "FreeFrame"
WORKSPACE_SETTINGS_ID = 1


def get_workspace_settings(db: Session) -> WorkspaceSettings:
    settings = db.query(WorkspaceSettings).filter(
        WorkspaceSettings.id == WORKSPACE_SETTINGS_ID
    ).first()
    if settings is not None:
        return settings

    settings = WorkspaceSettings(id=WORKSPACE_SETTINGS_ID, name=DEFAULT_WORKSPACE_NAME)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def get_workspace_name(db: Session) -> str:
    settings = db.query(WorkspaceSettings).filter(
        WorkspaceSettings.id == WORKSPACE_SETTINGS_ID
    ).first()
    if settings is None or not settings.name:
        return DEFAULT_WORKSPACE_NAME
    return settings.name
