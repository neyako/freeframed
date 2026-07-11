from datetime import datetime, timezone

import pytest

from apps.api.models.asset import Asset, AssetType, AssetVersion, ProcessingStatus
from apps.api.models.comment import Comment, CommentAttachment, CommentReaction
from apps.api.tests.integration._comment_security_support import (
    add_comment,
    comment_security,
    request_as,
)


def _foreign_version(world) -> tuple[Asset, AssetVersion]:
    owner = world.actors["owner"]
    asset = Asset(
        project_id=world.private.asset.project_id,
        name="foreign",
        asset_type=AssetType.video,
        created_by=owner.id,
    )
    world.db.add(asset)
    world.db.flush()
    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.ready,
        created_by=owner.id,
    )
    world.db.add(version)
    world.db.commit()
    return asset, version


@pytest.mark.parametrize("guest", (False, True))
@pytest.mark.parametrize("version_state", ("foreign", "deleted"))
def test_create_rejects_foreign_or_deleted_version_before_writes(
    comment_security,
    guest: bool,
    version_state: str,
) -> None:
    _, foreign = _foreign_version(comment_security)
    version = foreign if version_state == "foreign" else comment_security.private.version
    if version_state == "deleted":
        version.deleted_at = datetime.now(timezone.utc)
        comment_security.db.commit()
    before = comment_security.db.query(Comment).count()
    if guest:
        response = comment_security.client.post(
            f"/share/{comment_security.comment_link.token}/comment",
            json={
                "version_id": str(version.id),
                "body": "guest",
                "guest_email": "guest-integrity@example.test",
                "guest_name": "Guest",
            },
        )
    else:
        response = request_as(
            comment_security,
            "reviewer",
            "POST",
            f"/assets/{comment_security.private.asset.id}/comments",
            {"version_id": str(version.id), "body": "auth"},
        )

    assert response.status_code == 404, response.text
    assert comment_security.db.query(Comment).count() == before


@pytest.mark.parametrize("guest", (False, True))
@pytest.mark.parametrize("parent_state", ("foreign", "deleted"))
def test_reply_rejects_foreign_or_deleted_parent_before_writes(
    comment_security,
    guest: bool,
    parent_state: str,
) -> None:
    foreign_asset, foreign_version = _foreign_version(comment_security)
    parent = add_comment(
        comment_security.db,
        foreign_asset,
        foreign_version,
        comment_security.actors["reviewer"],
    )
    if parent_state == "deleted":
        parent.asset_id = comment_security.private.asset.id
        parent.version_id = comment_security.private.version.id
        parent.deleted_at = datetime.now(timezone.utc)
    comment_security.db.commit()
    before = comment_security.db.query(Comment).count()
    if guest:
        response = comment_security.client.post(
            f"/share/{comment_security.comment_link.token}/comment",
            json={
                "version_id": str(comment_security.private.version.id),
                "parent_id": str(parent.id),
                "body": "guest reply",
                "guest_email": "guest-parent@example.test",
                "guest_name": "Guest",
            },
        )
    else:
        response = request_as(
            comment_security,
            "reviewer",
            "POST",
            f"/assets/{comment_security.private.asset.id}/comments/{parent.id}/replies",
            {"version_id": str(comment_security.private.version.id), "body": "reply"},
        )

    assert response.status_code == 404, response.text
    assert comment_security.db.query(Comment).count() == before


def test_valid_reply_inherits_parent_version_visibility_and_rejects_body_conflict(
    comment_security,
) -> None:
    parent = comment_security.private.parent
    parent.visibility = "internal"
    comment_security.db.commit()

    accepted = request_as(
        comment_security,
        "reviewer",
        "POST",
        f"/assets/{comment_security.private.asset.id}/comments/{parent.id}/replies",
        {"version_id": str(parent.version_id), "parent_id": str(parent.id), "body": "reply"},
    )
    conflict = request_as(
        comment_security,
        "reviewer",
        "POST",
        f"/assets/{comment_security.private.asset.id}/comments/{parent.id}/replies",
        {
            "version_id": str(parent.version_id),
            "parent_id": str(comment_security.private.other.id),
            "body": "conflict",
        },
    )

    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["version_id"] == str(parent.version_id)
    assert accepted.json()["visibility"] == "internal"
    assert conflict.status_code in (400, 422), conflict.text


@pytest.mark.parametrize("version_state", ("foreign", "deleted"))
@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    (
        ("GET", "/reactions", None),
        ("PATCH", "", {"body": "edited"}),
        ("POST", "/resolve", None),
        ("POST", "/react", {"emoji": "ok"}),
    ),
)
def test_id_only_routes_reject_comment_with_invalid_version_context(
    comment_security,
    version_state: str,
    method: str,
    suffix: str,
    payload,
) -> None:
    _, foreign = _foreign_version(comment_security)
    version = foreign if version_state == "foreign" else comment_security.private.version
    if version_state == "deleted":
        version.deleted_at = datetime.now(timezone.utc)
    comment = Comment(
        asset_id=comment_security.private.asset.id,
        version_id=version.id,
        author_id=comment_security.actors["reviewer"].id,
        body="corrupt",
    )
    comment_security.db.add(comment)
    comment_security.db.commit()

    response = request_as(
        comment_security,
        "reviewer",
        method,
        f"/comments/{comment.id}{suffix}",
        payload,
    )

    assert response.status_code == 404, response.text


def test_foreign_attachment_pairing_has_no_side_effect(
    comment_security,
) -> None:
    foreign_attachment = CommentAttachment(
        comment_id=comment_security.private.parent.id,
        file_type="text/plain",
        s3_key="synthetic/foreign",
        original_filename="foreign.txt",
        file_size_bytes=4,
    )
    comment_security.db.add(foreign_attachment)
    comment_security.db.commit()
    before = comment_security.db.query(CommentAttachment).count()

    response = request_as(
        comment_security,
        "owner",
        "DELETE",
        f"/comments/{comment_security.private.other.id}/attachments/{foreign_attachment.id}",
    )

    assert response.status_code == 404, response.text
    assert comment_security.db.query(CommentAttachment).count() == before
    assert comment_security.s3_delete.call_count == 0
