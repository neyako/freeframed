from datetime import datetime, timezone

import pytest

from apps.api.models.comment import CommentAttachment, CommentReaction
from apps.api.tests.integration._comment_security_support import (
    comment_security,
    dispatch_mutation,
    request_as,
)


ACTORS = ("owner", "editor", "unrelated_private")
MUTATIONS = ("create", "reply", "resolve", "react", "attach", "edit", "delete")
MEMBERS = {"owner", "editor"}
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
def test_mutation_matrix_allows_project_members_only(
    comment_security,
    actor_name: str,
    mutation: str,
) -> None:
    response = dispatch_mutation(comment_security, actor_name, mutation)

    expected = SUCCESS[mutation] if actor_name in MEMBERS else 403
    assert response.status_code == expected, response.text


@pytest.mark.parametrize("actor_name", ACTORS)
@pytest.mark.parametrize("method", ("PATCH", "DELETE"))
def test_edit_delete_never_allows_another_author(
    comment_security,
    actor_name: str,
    method: str,
) -> None:
    payload = {"body": "forbidden"} if method == "PATCH" else None

    response = request_as(
        comment_security,
        actor_name,
        method,
        f"/comments/{comment_security.private.other.id}",
        payload,
    )

    assert response.status_code == 403, response.text


@pytest.mark.parametrize("mutation", ("edit", "delete", "resolve", "react"))
def test_removed_member_loses_mutations_on_own_comment(
    comment_security,
    mutation: str,
) -> None:
    comment_security.members["editor"].deleted_at = datetime.now(timezone.utc)
    comment_security.db.commit()

    response = dispatch_mutation(comment_security, "editor", mutation)

    assert response.status_code == 403, response.text


@pytest.mark.parametrize(
    ("actor_name", "own_comment", "expected"),
    (
        ("owner", False, 204),
        ("editor", False, 204),
        ("editor", True, 204),
        ("unrelated_private", True, 403),
    ),
)
def test_attachment_delete_requires_project_membership(
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


@pytest.mark.parametrize(("actor_name", "expected"), (("editor", 204), ("unrelated_private", 403)))
def test_reaction_toggle_removes_only_for_members(
    comment_security,
    actor_name: str,
    expected: int,
) -> None:
    comment = comment_security.private.own[actor_name]
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


def test_resolve_toggle_allows_superadmin(comment_security) -> None:
    actor_name = "unrelated_private"
    actor = comment_security.actors[actor_name]
    comment = comment_security.private.own[actor_name]
    actor.is_superadmin = True
    comment.resolved = True
    comment_security.db.commit()

    response = dispatch_mutation(comment_security, actor_name, "resolve")

    assert response.status_code == 200, response.text
    comment_security.db.refresh(comment)
    assert comment.resolved is False
