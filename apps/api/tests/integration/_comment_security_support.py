from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from apps.api.database import get_db
from apps.api.main import app
from apps.api.middleware.auth import get_current_user, get_optional_user
from apps.api.models.asset import Asset, AssetType, AssetVersion, ProcessingStatus
from apps.api.models.comment import Comment, CommentAttachment
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, ShareLink, SharePermission
from apps.api.models.user import User


@dataclass(frozen=True, slots=True)
class CommentTarget:
    asset: Asset
    version: AssetVersion
    parent: Comment
    own: dict[str, Comment]
    other: Comment
    attachment: CommentAttachment


@dataclass(frozen=True, slots=True)
class CommentSecurityWorld:
    db: Session
    client: TestClient
    actors: dict[str, User]
    private: CommentTarget
    public: CommentTarget
    members: dict[str, ProjectMember]
    shares: dict[str, AssetShare]
    comment_link: ShareLink
    view_link: ShareLink
    s3_delete: MagicMock


def _asset(db: Session, project_id, creator_id, number: int = 1) -> tuple[Asset, AssetVersion]:
    asset = Asset(
        project_id=project_id,
        name=f"asset-{number}",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    version = AssetVersion(
        asset_id=asset.id,
        version_number=number,
        processing_status=ProcessingStatus.ready,
        created_by=creator_id,
    )
    db.add(version)
    db.flush()
    return asset, version


def add_comment(
    db: Session,
    asset: Asset,
    version: AssetVersion,
    author: User | None,
    *,
    parent: Comment | None = None,
    visibility: str = "public",
) -> Comment:
    comment = Comment(
        asset_id=asset.id,
        version_id=version.id,
        parent_id=parent.id if parent else None,
        author_id=author.id if author else None,
        body="synthetic comment",
        visibility=visibility,
    )
    db.add(comment)
    db.flush()
    return comment


def _target(
    db: Session,
    asset: Asset,
    version: AssetVersion,
    actors: dict[str, User],
) -> CommentTarget:
    parent = add_comment(db, asset, version, actors["reviewer"])
    own = {name: add_comment(db, asset, version, actor) for name, actor in actors.items()}
    other = add_comment(db, asset, version, None)
    attachment = CommentAttachment(
        comment_id=other.id,
        file_type="text/plain",
        s3_key="synthetic/attachment",
        original_filename="note.txt",
        file_size_bytes=7,
    )
    db.add(attachment)
    db.flush()
    return CommentTarget(asset, version, parent, own, other, attachment)


@pytest.fixture()
def comment_security(db, make_project, make_user) -> CommentSecurityWorld:
    project, seed_owner = make_project()
    public_project, public_owner = make_project(is_public=True)
    actors = {
        name: make_user(name=name)
        for name in (
            "owner",
            "editor",
            "reviewer",
            "viewer",
            "direct_approve",
            "direct_comment",
            "direct_view",
            "public_reader",
            "unrelated_private",
        )
    }
    members: dict[str, ProjectMember] = {}
    for name, role in (
        ("owner", ProjectRole.owner),
        ("editor", ProjectRole.editor),
        ("reviewer", ProjectRole.reviewer),
        ("viewer", ProjectRole.viewer),
    ):
        member = ProjectMember(project_id=project.id, user_id=actors[name].id, role=role)
        db.add(member)
        members[name] = member
    private_asset, private_version = _asset(db, project.id, seed_owner.id)
    public_asset, public_version = _asset(db, public_project.id, public_owner.id)
    shares: dict[str, AssetShare] = {}
    for name, permission in (
        ("direct_approve", SharePermission.approve),
        ("direct_comment", SharePermission.comment),
        ("direct_view", SharePermission.view),
    ):
        share = AssetShare(
            asset_id=private_asset.id,
            shared_with_user_id=actors[name].id,
            permission=permission,
            shared_by=seed_owner.id,
        )
        db.add(share)
        shares[name] = share
    private = _target(db, private_asset, private_version, actors)
    public = _target(db, public_asset, public_version, actors)
    comment_link = ShareLink(
        asset_id=private_asset.id,
        token="task7-comment-link",
        created_by=seed_owner.id,
        permission=SharePermission.comment,
    )
    view_link = ShareLink(
        asset_id=private_asset.id,
        token="task7-view-link",
        created_by=seed_owner.id,
        permission=SharePermission.view,
    )
    db.add_all([comment_link, view_link])
    db.commit()
    s3 = MagicMock()
    s3.generate_presigned_url.return_value = "https://upload.invalid/synthetic"
    with (
        patch("apps.api.routers.comments.s3_service.get_s3_client", return_value=s3),
        patch("apps.api.routers.comments.s3_service.delete_object") as s3_delete,
        patch(
            "apps.api.middleware.global_rate_limit.get_redis",
            side_effect=ConnectionError,
        ),
    ):
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_optional_user] = lambda: None
        with TestClient(app, raise_server_exceptions=False) as client:
            yield CommentSecurityWorld(
                db,
                client,
                actors,
                private,
                public,
                members,
                shares,
                comment_link,
                view_link,
                s3_delete,
            )
        app.dependency_overrides.clear()


def target_for(world: CommentSecurityWorld, actor_name: str) -> CommentTarget:
    return world.public if actor_name == "public_reader" else world.private


def request_as(world: CommentSecurityWorld, actor_name: str, method: str, path: str, payload=None):
    actor = world.actors[actor_name]
    app.dependency_overrides[get_current_user] = lambda: actor
    response = world.client.request(method, path, json=payload)
    world.db.expire_all()
    return response


def dispatch_mutation(world: CommentSecurityWorld, actor_name: str, mutation: str):
    target = target_for(world, actor_name)
    comment = target.own[actor_name]
    routes = {
        "create": ("POST", f"/assets/{target.asset.id}/comments", {"version_id": str(target.version.id), "body": "new"}),
        "reply": ("POST", f"/assets/{target.asset.id}/comments/{target.parent.id}/replies", {"version_id": str(target.version.id), "body": "reply"}),
        "resolve": ("POST", f"/comments/{comment.id}/resolve", None),
        "react": ("POST", f"/comments/{comment.id}/react", {"emoji": "ok"}),
        "attach": ("POST", f"/comments/{comment.id}/attachments", {"file_name": "note.txt", "file_size": 7, "content_type": "text/plain"}),
        "edit": ("PATCH", f"/comments/{comment.id}", {"body": "edited"}),
        "delete": ("DELETE", f"/comments/{comment.id}", None),
    }
    method, path, payload = routes[mutation]
    return request_as(world, actor_name, method, path, payload)


def active_count(world: CommentSecurityWorld, model) -> int:
    return world.db.query(model).count()


def revoke_now(row) -> None:
    row.deleted_at = datetime.now(timezone.utc)
