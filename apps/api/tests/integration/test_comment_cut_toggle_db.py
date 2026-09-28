"""A range comment can be marked as a cut after posting (and back)."""
from apps.api.tests.integration._comment_security_support import (  # noqa: F401 - fixture
    add_comment,
    comment_security,
    request_as,
)


def _note(world, start, end):
    note = add_comment(world.db, world.private.asset, world.private.version, world.actors["editor"])
    note.timecode_start, note.timecode_end = start, end
    world.db.commit()
    return note


def test_owner_turns_the_editors_range_comment_into_a_cut_and_back(comment_security) -> None:
    note = _note(comment_security, 6.8, 9.0)

    marked = request_as(comment_security, "owner", "POST", f"/comments/{note.id}/cut")
    unmarked = request_as(comment_security, "owner", "POST", f"/comments/{note.id}/cut")

    assert marked.status_code == 200 and marked.json()["is_cut"] is True
    assert unmarked.status_code == 200 and unmarked.json()["is_cut"] is False


def test_point_comment_cannot_become_a_cut(comment_security) -> None:
    note = _note(comment_security, 6.8, None)

    response = request_as(comment_security, "owner", "POST", f"/comments/{note.id}/cut")

    assert response.status_code == 400


def test_outsider_cannot_mark_cuts(comment_security) -> None:
    note = _note(comment_security, 6.8, 9.0)

    response = request_as(comment_security, "unrelated_private", "POST", f"/comments/{note.id}/cut")

    assert response.status_code in (403, 404)
