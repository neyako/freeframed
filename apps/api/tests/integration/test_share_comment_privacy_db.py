from datetime import datetime, timezone

import pytest

from apps.api.models.asset import AssetVersion, ProcessingStatus
from apps.api.models.comment import Comment
from apps.api.models.user import GuestUser
from apps.api.tests.integration._comment_security_support import add_comment, comment_security


def _ids(nodes) -> set[str]:
    found: set[str] = set()
    frontier = list(nodes)
    while frontier:
        node = frontier.pop()
        found.add(node["id"])
        frontier.extend(node["replies"])
    return found


def test_share_tree_prunes_hidden_subtrees_scopes_version_and_hides_guest_email(
    comment_security,
) -> None:
    world = comment_security
    asset = world.private.asset
    v1 = world.private.version
    v2 = AssetVersion(
        asset_id=asset.id,
        version_number=2,
        processing_status=ProcessingStatus.ready,
        created_by=world.actors["owner"].id,
    )
    world.db.add(v2)
    world.db.flush()
    guest = GuestUser(email="private-guest@example.test", name="Guest")
    world.db.add(guest)
    world.db.flush()
    root = add_comment(world.db, asset, v1, None)
    root.guest_author_id = guest.id
    public_reply = add_comment(world.db, asset, v1, world.actors["reviewer"], parent=root)
    internal_reply = add_comment(
        world.db,
        asset,
        v1,
        world.actors["reviewer"],
        parent=root,
        visibility="internal",
    )
    hidden_grandchild = add_comment(
        world.db,
        asset,
        v1,
        world.actors["reviewer"],
        parent=internal_reply,
    )
    internal_root = add_comment(
        world.db,
        asset,
        v1,
        world.actors["reviewer"],
        visibility="internal",
    )
    hidden_child = add_comment(
        world.db,
        asset,
        v1,
        world.actors["reviewer"],
        parent=internal_root,
    )
    other_version = add_comment(world.db, asset, v2, world.actors["reviewer"])
    cross_version = add_comment(world.db, asset, v2, world.actors["reviewer"], parent=root)
    deleted_version = AssetVersion(
        asset_id=asset.id,
        version_number=3,
        processing_status=ProcessingStatus.ready,
        created_by=world.actors["owner"].id,
        deleted_at=datetime.now(timezone.utc),
    )
    world.db.add(deleted_version)
    world.db.flush()
    deleted_version_reply = add_comment(
        world.db,
        asset,
        deleted_version,
        world.actors["reviewer"],
        parent=root,
    )
    world.db.commit()

    response = world.client.get(
        f"/share/{world.comment_link.token}/comments?version_id={v1.id}"
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    visible = _ids(payload)
    assert str(root.id) in visible
    assert str(public_reply.id) in visible
    assert str(internal_reply.id) not in visible
    assert str(hidden_grandchild.id) not in visible
    assert str(internal_root.id) not in visible
    assert str(hidden_child.id) not in visible
    assert str(other_version.id) not in visible
    assert str(cross_version.id) not in visible
    root_payload = next(node for node in payload if node["id"] == str(root.id))
    assert root_payload["guest_author"] == {"id": str(guest.id), "name": "Guest"}

    unfiltered = world.client.get(f"/share/{world.comment_link.token}/comments")
    assert unfiltered.status_code == 200, unfiltered.text
    unfiltered_visible = _ids(unfiltered.json())
    assert str(cross_version.id) not in unfiltered_visible
    assert str(deleted_version_reply.id) not in unfiltered_visible


@pytest.mark.parametrize("version_state", ("foreign", "deleted"))
def test_share_version_filter_rejects_foreign_or_deleted_version(
    comment_security,
    version_state: str,
) -> None:
    version = comment_security.public.version
    if version_state == "deleted":
        version = comment_security.private.version
        version.deleted_at = datetime.now(timezone.utc)
        comment_security.db.commit()

    response = comment_security.client.get(
        f"/share/{comment_security.comment_link.token}/comments?version_id={version.id}"
    )

    assert response.status_code == 404, response.text


def test_guest_reply_inherits_public_parent_version_and_strips_email(
    comment_security,
) -> None:
    world = comment_security
    v2 = AssetVersion(
        asset_id=world.private.asset.id,
        version_number=2,
        processing_status=ProcessingStatus.ready,
        created_by=world.actors["owner"].id,
    )
    world.db.add(v2)
    world.db.commit()
    parent = world.private.parent
    payload = {
        "version_id": str(parent.version_id),
        "parent_id": str(parent.id),
        "body": "guest reply",
        "guest_email": "reply-guest@example.test",
        "guest_name": "Guest",
    }

    accepted = world.client.post(
        f"/share/{world.comment_link.token}/comment",
        json=payload,
    )
    conflict = world.client.post(
        f"/share/{world.comment_link.token}/comment",
        json={**payload, "version_id": str(v2.id)},
    )
    denied = world.client.post(
        f"/share/{world.view_link.token}/comment",
        json=payload,
    )

    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["version_id"] == str(parent.version_id)
    assert accepted.json()["visibility"] == "public"
    assert accepted.json()["guest_author"] == {
        "id": accepted.json()["guest_author_id"],
        "name": "Guest",
    }
    assert conflict.status_code in (400, 422), conflict.text
    assert denied.status_code == 403, denied.text
