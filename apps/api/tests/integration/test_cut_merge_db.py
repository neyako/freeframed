"""Overlapping or touching cuts merge into one: earliest survives, notes become replies."""
from apps.api.models.comment import Comment
from apps.api.tests.integration._comment_security_support import (  # noqa: F401 - fixture
    comment_security,
    request_as,
)


def _cut(world, start, end, body=""):
    response = request_as(world, "owner", "POST", f"/assets/{world.private.asset.id}/comments", {
        "version_id": str(world.private.version.id),
        "body": body,
        "timecode_start": start,
        "timecode_end": end,
        "is_cut": True,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _cuts(world):
    return (
        world.db.query(Comment)
        .filter(Comment.is_cut.is_(True), Comment.deleted_at.is_(None))
        .order_by(Comment.timecode_start)
        .all()
    )


def test_overlapping_cut_extends_the_existing_one_and_its_note_becomes_a_reply(comment_security) -> None:
    first = _cut(comment_security, 10, 20, "intro drags")
    second = _cut(comment_security, 15, 30, "and this bit")

    [cut] = _cuts(comment_security)
    assert str(cut.id) == first["id"]
    assert (cut.timecode_start, cut.timecode_end) == (10, 30)
    reply = comment_security.db.get(Comment, second["id"])
    assert reply.parent_id == cut.id and reply.body == "and this bit" and not reply.is_cut


def test_a_cut_bridging_two_cuts_merges_all_three(comment_security) -> None:
    _cut(comment_security, 10, 20, "a")
    _cut(comment_security, 40, 50, "b")
    _cut(comment_security, 18, 42)

    [cut] = _cuts(comment_security)
    assert (cut.timecode_start, cut.timecode_end) == (10, 50)
    notes = {c.body for c in comment_security.db.query(Comment).filter(Comment.parent_id == cut.id)}
    assert notes == {"b"}  # the empty bridging cut leaves no empty reply


def test_touching_cuts_merge_and_separate_cuts_stay_apart(comment_security) -> None:
    _cut(comment_security, 10, 20)
    returned = _cut(comment_security, 20, 25)
    _cut(comment_security, 40, 45)

    cuts = _cuts(comment_security)
    assert [(c.timecode_start, c.timecode_end) for c in cuts] == [(10, 25), (40, 45)]
    assert returned["id"] == str(cuts[0].id)  # empty merged cut hands back the survivor
