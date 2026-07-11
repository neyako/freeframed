from datetime import datetime, timezone

import pytest

from apps.api.models.comment import CommentAttachment, CommentReaction
from apps.api.models.project import ProjectRole
from apps.api.tests.integration._comment_security_support import (
    comment_security,
    dispatch_mutation,
    request_as,
    revoke_now,
    target_for,
)


ACTORS = (
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
MUTATIONS = ("create", "reply", "resolve", "react", "attach", "edit", "delete")
ALLOWED = {"owner", "editor", "reviewer", "direct_approve", "direct_comment"}
SUCCESS = {
    "create": 201,
    "reply": 201,
    "resolve": 200,
    "react": 204,
    "attach": 201,
    "edit": 200,
    "delete": 204,
}


@pytest.mark.parametrize("actor_name", ACTORS)
@pytest.mark.parametrize("mutation", MUTATIONS)
def test_mutation_matrix_uses_current_comment_capability(
    comment_security,
    actor_name: str,
    mutation: str,
) -> None:
    response = dispatch_mutation(comment_security, actor_name, mutation)

    expected = SUCCESS[mutation] if actor_name in ALLOWED else 403
    assert response.status_code == expected, response.text


@pytest.mark.parametrize("actor_name", ACTORS)
@pytest.mark.parametrize("method", ("PATCH", "DELETE"))
def test_edit_delete_never_allows_another_author(
    comment_security,
    actor_name: str,
    method: str,
) -> None:
    target = target_for(comment_security, actor_name)
    payload = {"body": "forbidden"} if method == "PATCH" else None

    response = request_as(
        comment_security,
        actor_name,
        method,
        f"/comments/{target.other.id}",
        payload,
    )

    assert response.status_code == 403, response.text


@pytest.mark.parametrize("mutation", ("edit", "delete"))
@pytest.mark.parametrize("revocation", ("viewer", "member_deleted", "share_deleted"))
def test_historical_author_loses_mutation_after_capability_revocation(
    comment_security,
    mutation: str,
    revocation: str,
) -> None:
    if revocation == "share_deleted":
        actor_name = "direct_comment"
        revoke_now(comment_security.shares[actor_name])
    else:
        actor_name = "reviewer"
        member = comment_security.members[actor_name]
        if revocation == "viewer":
            member.role = ProjectRole.viewer
        else:
            member.deleted_at = datetime.now(timezone.utc)
    comment_security.db.commit()

    response = dispatch_mutation(comment_security, actor_name, mutation)

    assert response.status_code == 403, response.text


@pytest.mark.parametrize(
    ("actor_name", "own_comment", "expected"),
    (
        ("owner", False, 204),
        ("editor", False, 204),
        ("reviewer", False, 403),
        ("direct_comment", False, 403),
        ("direct_approve", False, 403),
        ("reviewer", True, 204),
        ("direct_comment", True, 204),
        ("direct_approve", True, 204),
        ("viewer", True, 403),
        ("direct_view", True, 403),
    ),
)
def test_attachment_delete_requires_capability_and_author_or_moderator(
    comment_security,
    actor_name: str,
    own_comment: bool,
    expected: int,
) -> None:
    target = comment_security.private
    if own_comment:
        comment = target.own[actor_name]
        attachment = CommentAttachment(
            comment_id=comment.id,
            file_type="text/plain",
            s3_key=f"synthetic/{actor_name}",
            original_filename="note.txt",
            file_size_bytes=7,
        )
        comment_security.db.add(attachment)
        comment_security.db.commit()
    else:
        comment = target.other
        attachment = target.attachment

    response = request_as(
        comment_security,
        actor_name,
        "DELETE",
        f"/comments/{comment.id}/attachments/{attachment.id}",
    )

    assert response.status_code == expected, response.text
    assert comment_security.s3_delete.call_count == (1 if expected == 204 else 0)


@pytest.mark.parametrize(
    ("actor_name", "expected"),
    (
        ("reviewer", 204),
        ("direct_comment", 204),
        ("viewer", 403),
        ("direct_view", 403),
    ),
)
def test_reaction_toggle_removes_only_with_current_capability(
    comment_security,
    actor_name: str,
    expected: int,
) -> None:
    comment = target_for(comment_security, actor_name).own[actor_name]
    reaction = CommentReaction(
        comment_id=comment.id,
        user_id=comment_security.actors[actor_name].id,
        emoji="ok",
    )
    comment_security.db.add(reaction)
    comment_security.db.commit()

    response = dispatch_mutation(comment_security, actor_name, "react")

    assert response.status_code == expected, response.text
    remaining = comment_security.db.query(CommentReaction).filter(
        CommentReaction.id == reaction.id,
    ).first()
    assert (remaining is None) is (expected == 204)


@pytest.mark.parametrize(
    ("actor_name", "expected"),
    (
        ("reviewer", 200),
        ("direct_comment", 200),
        ("viewer", 403),
        ("direct_view", 403),
    ),
)
def test_resolve_toggle_unresolves_only_with_current_capability(
    comment_security,
    actor_name: str,
    expected: int,
) -> None:
    comment = target_for(comment_security, actor_name).own[actor_name]
    comment.resolved = True
    comment_security.db.commit()

    response = dispatch_mutation(comment_security, actor_name, "resolve")

    assert response.status_code == expected, response.text
    comment_security.db.refresh(comment)
    assert comment.resolved is (expected != 200)
