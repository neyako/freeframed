import uuid
from unittest.mock import patch

from apps.api.models.activity import Notification, NotificationType
from apps.api.models.asset import Asset
from apps.api.models.project import ProjectMember, ProjectRole


def _add_member(db, project_id, user_id, role: ProjectRole) -> ProjectMember:
    member = ProjectMember(project_id=project_id, user_id=user_id, role=role)
    db.add(member)
    db.flush()
    return member


def _initiate_upload(db, user, project_id):
    from fastapi.testclient import TestClient

    from apps.api.database import get_db
    from apps.api.main import app
    from apps.api.middleware.auth import get_current_user

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with (
            patch("apps.api.main.ensure_bucket_exists"),
            patch("apps.api.routers.upload.create_multipart_upload", return_value="upload-123"),
        ):
            with TestClient(app, raise_server_exceptions=False) as client:
                return client.post(
                    "/upload/initiate",
                    json={
                        "project_id": str(project_id),
                        "asset_name": "clip.mov",
                        "original_filename": "clip.mov",
                        "mime_type": "video/quicktime",
                        "file_size_bytes": 1024,
                    },
                )
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def test_quick_share_upload_assigns_designated_reviewer(db, make_project, make_user) -> None:
    # Given
    project, _owner = make_project()
    project.is_quick_share = True
    uploader = make_user("uploader@example.com", "Uploader")
    reviewer = make_user("reviewer@example.com", "Reviewer")
    _add_member(db, project.id, uploader.id, ProjectRole.editor)
    _add_member(db, project.id, reviewer.id, ProjectRole.reviewer)
    db.commit()

    # When
    response = _initiate_upload(db, uploader, project.id)

    # Then
    assert response.status_code == 200, response.text
    asset_id = uuid.UUID(response.json()["asset_id"])
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).one()
    assert asset.assignee_id == reviewer.id
    notification = (
        db.query(Notification)
        .filter(
            Notification.user_id == reviewer.id,
            Notification.type == NotificationType.assignment,
            Notification.asset_id == asset.id,
        )
        .one_or_none()
    )
    assert notification is not None


def test_non_quick_share_upload_leaves_asset_unassigned(db, make_project, make_user) -> None:
    # Given
    project, _owner = make_project()
    uploader = make_user("uploader@example.com", "Uploader")
    reviewer = make_user("reviewer@example.com", "Reviewer")
    _add_member(db, project.id, uploader.id, ProjectRole.editor)
    _add_member(db, project.id, reviewer.id, ProjectRole.reviewer)
    db.commit()

    # When
    response = _initiate_upload(db, uploader, project.id)

    # Then
    assert response.status_code == 200, response.text
    asset_id = uuid.UUID(response.json()["asset_id"])
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).one()
    assert asset.assignee_id is None
    notification = db.query(Notification).filter(Notification.asset_id == asset.id).one_or_none()
    assert notification is None
