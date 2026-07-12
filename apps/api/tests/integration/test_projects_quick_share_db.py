import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from apps.api.database import get_db
from apps.api.main import app
from apps.api.middleware.auth import get_current_user
from apps.api.models.asset import Asset, AssetStatus, AssetType
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.user import User
from apps.api.routers.projects import get_or_create_quick_share_project
from apps.api.tests.integration.project_test_helpers import (
    _active_owner_ids,
    _member,
    _project_with_owner,
)


@contextmanager
def _http_client(db):
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        with patch("apps.api.main.ensure_bucket_exists"):
            with TestClient(app, raise_server_exceptions=False) as client:
                yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def _use_user(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _asset(project: Project, user: User, name: str) -> Asset:
    return Asset(
        project_id=project.id,
        name=name,
        asset_type=AssetType.video,
        status=AssetStatus.draft,
        created_by=user.id,
    )


def test_quick_share_is_scoped_to_creator_over_http(db, make_user) -> None:
    # Given
    user_a = make_user("user-a@invalid.test", "User A")
    user_b = make_user("user-b@invalid.test", "User B")
    user_a.is_superadmin = True
    db.commit()

    with _http_client(db) as client:
        _use_user(user_a)
        first_a = client.post("/projects/quick-share")
        assert first_a.status_code == 200, first_a.text
        project_a_id = uuid.UUID(first_a.json()["id"])

        foreign_membership = ProjectMember(
            project_id=project_a_id,
            user_id=user_b.id,
            role=ProjectRole.viewer,
            deleted_at=datetime.now(timezone.utc),
        )
        deleted_b = Project(
            name="Deleted Quick Shares",
            created_by=user_b.id,
            is_quick_share=True,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add_all([foreign_membership, deleted_b])
        db.flush()
        deleted_b_id = deleted_b.id
        db.add(_member(deleted_b, user_b, ProjectRole.owner))
        db.commit()

        # When
        _use_user(user_b)
        first_b = client.post("/projects/quick-share")
        second_b = client.post("/projects/quick-share")
        _use_user(user_a)
        second_a = client.post("/projects/quick-share")

    # Then
    assert first_b.status_code == 200, first_b.text
    assert second_b.status_code == 200, second_b.text
    assert second_a.status_code == 200, second_a.text
    project_b_id = uuid.UUID(first_b.json()["id"])
    assert project_a_id != project_b_id
    assert uuid.UUID(second_a.json()["id"]) == project_a_id
    assert uuid.UUID(second_b.json()["id"]) == project_b_id

    active_projects = db.query(Project).filter(
        Project.is_quick_share.is_(True),
        Project.deleted_at.is_(None),
    ).all()
    assert {(project.created_by, project.id) for project in active_projects} == {
        (user_a.id, project_a_id),
        (user_b.id, project_b_id),
    }
    assert _active_owner_ids(db, project_a_id) == {user_a.id}
    assert _active_owner_ids(db, project_b_id) == {user_b.id}
    active_memberships = db.query(ProjectMember).filter(
        ProjectMember.project_id.in_([project_a_id, project_b_id]),
        ProjectMember.deleted_at.is_(None),
    ).all()
    assert {
        (member.project_id, member.user_id, member.role)
        for member in active_memberships
    } == {
        (project_a_id, user_a.id, ProjectRole.owner),
        (project_b_id, user_b.id, ProjectRole.owner),
    }
    db.refresh(foreign_membership)
    db.refresh(deleted_b)
    assert foreign_membership.deleted_at is not None
    assert foreign_membership.role == ProjectRole.viewer
    assert deleted_b.id == deleted_b_id
    assert deleted_b.deleted_at is not None


def test_cross_user_quick_share_assets_are_denied_over_http(db, make_user) -> None:
    # Given
    user_a = make_user("asset-a@invalid.test", "Asset A")
    user_b = make_user("asset-b@invalid.test", "Asset B")
    project_a = _project_with_owner(db, user_a)
    project_b = _project_with_owner(db, user_b)
    project_a.is_quick_share = True
    project_b.is_quick_share = True
    asset_a = _asset(project_a, user_a, "asset-a")
    asset_b = _asset(project_b, user_b, "asset-b")
    db.add_all([asset_a, asset_b])
    db.commit()

    with _http_client(db) as client:
        # When / Then: user B is denied from every user A surface.
        _use_user(user_b)
        statuses_b_to_a = [
            client.get(f"/assets/{asset_a.id}").status_code,
            client.patch(f"/assets/{asset_a.id}", json={"name": "tampered-a"}).status_code,
            client.delete(f"/assets/{asset_a.id}").status_code,
            client.get(f"/projects/{project_a.id}/assets").status_code,
        ]

        # When / Then: user A is denied from every user B surface.
        _use_user(user_a)
        statuses_a_to_b = [
            client.get(f"/assets/{asset_b.id}").status_code,
            client.patch(f"/assets/{asset_b.id}", json={"name": "tampered-b"}).status_code,
            client.delete(f"/assets/{asset_b.id}").status_code,
            client.get(f"/projects/{project_b.id}/assets").status_code,
        ]

    assert statuses_b_to_a == [403, 403, 403, 403]
    assert statuses_a_to_b == [403, 403, 403, 403]
    db.refresh(asset_a)
    db.refresh(asset_b)
    assert (asset_a.name, asset_a.deleted_at) == ("asset-a", None)
    assert (asset_b.name, asset_b.deleted_at) == ("asset-b", None)


def test_concurrent_quick_share_create_returns_single_owned_project(
    db, migrated_engine, make_user
) -> None:
    # Given
    user = make_user("quick-race@invalid.test", "Quick Race")
    db.commit()
    user_id = user.id
    barrier = threading.Barrier(2)
    local = threading.local()
    session_factory = sessionmaker(bind=migrated_engine)

    def gate_first_lookup(_conn, _cursor, statement, _parameters, _context, _executemany):
        if not getattr(local, "enabled", False):
            return
        normalized = " ".join(statement.lower().split())
        is_lookup = (
            normalized.startswith("select")
            and "from projects" in normalized
            and "is_quick_share" in normalized
            and "deleted_at is null" in normalized
        )
        if is_lookup and not getattr(local, "lookup_seen", False):
            local.lookup_seen = True
            barrier.wait(timeout=10)

    def create_quick_share() -> uuid.UUID:
        session = session_factory()
        local.enabled = True
        local.lookup_seen = False
        try:
            thread_user = session.query(User).filter(User.id == user_id).one()
            project = get_or_create_quick_share_project(db=session, current_user=thread_user)
            return project.id
        finally:
            local.enabled = False
            session.close()

    # When
    executor = ThreadPoolExecutor(max_workers=2)
    futures = []
    workers_stopped = True
    event.listen(migrated_engine, "after_cursor_execute", gate_first_lookup)
    try:
        futures = [executor.submit(create_quick_share) for _ in range(2)]
        project_ids = [future.result(timeout=20) for future in futures]
    finally:
        if futures:
            _, not_done = wait(futures, timeout=5)
            workers_stopped = not not_done
        executor.shutdown(wait=workers_stopped, cancel_futures=True)
        event.remove(migrated_engine, "after_cursor_execute", gate_first_lookup)

    # Then
    assert workers_stopped, "quick-share workers did not stop"
    assert project_ids[0] == project_ids[1]
    db.expire_all()
    active_projects = db.query(Project).filter(
        Project.created_by == user_id,
        Project.is_quick_share.is_(True),
        Project.deleted_at.is_(None),
    ).all()
    assert [project.id for project in active_projects] == [project_ids[0]]
    assert _active_owner_ids(db, project_ids[0]) == {user_id}
