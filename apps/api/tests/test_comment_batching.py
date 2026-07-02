import uuid
from datetime import datetime, timezone

from apps.api.models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from apps.api.models.user import GuestUser, User, UserStatus
from apps.api.routers.comments import _assemble_comment_response


def _comment(
    asset_id: uuid.UUID,
    version_id: uuid.UUID,
    body: str,
) -> Comment:
    now = datetime.now(timezone.utc)
    return Comment(
        id=uuid.uuid4(),
        asset_id=asset_id,
        version_id=version_id,
        parent_id=None,
        author_id=None,
        guest_author_id=None,
        timecode_start=None,
        timecode_end=None,
        body=body,
        resolved=False,
        visibility="public",
        created_at=now,
        updated_at=now,
    )


def test_assemble_comment_response_preserves_nested_maps_and_reactions() -> None:
    asset_id = uuid.uuid4()
    version_id = uuid.uuid4()
    author_id = uuid.uuid4()
    reactor_id = uuid.uuid4()
    guest_id = uuid.uuid4()
    root = _comment(asset_id, version_id, "Root")
    root.author_id = author_id
    first_reply = _comment(asset_id, version_id, "First")
    first_reply.parent_id = root.id
    first_reply.guest_author_id = guest_id
    second_reply = _comment(asset_id, version_id, "Second")
    second_reply.parent_id = root.id
    nested_reply = _comment(asset_id, version_id, "Nested")
    nested_reply.parent_id = first_reply.id
    user = User(
        id=author_id,
        email="author@example.com",
        name="Author",
        avatar_url="https://example.test/avatar.png",
        status=UserStatus.active,
        email_verified=True,
    )
    guest = GuestUser(
        id=guest_id,
        email="guest@example.com",
        name="Guest",
    )
    annotation = Annotation(
        id=uuid.uuid4(),
        comment_id=root.id,
        drawing_data={"objects": []},
        frame_number=12,
        carousel_position=None,
    )
    attachment = CommentAttachment(
        id=uuid.uuid4(),
        comment_id=root.id,
        file_type="image/png",
        s3_key="attachments/root.png",
        original_filename="root.png",
        file_size_bytes=128,
    )
    reactions = [
        CommentReaction(
            id=uuid.uuid4(),
            comment_id=root.id,
            user_id=reactor_id,
            emoji="ok",
        ),
        CommentReaction(
            id=uuid.uuid4(),
            comment_id=root.id,
            user_id=uuid.uuid4(),
            emoji="ok",
        ),
    ]
    data = {
        "comments_by_parent": {
            root.id: [first_reply, second_reply],
            first_reply.id: [nested_reply],
        },
        "annotations": {root.id: annotation},
        "attachments": {root.id: [attachment]},
        "reactions": {root.id: reactions},
        "users": {author_id: user},
        "guests": {guest_id: guest},
    }

    response = _assemble_comment_response(root, data, current_user_id=reactor_id)

    assert response.author is not None
    assert response.author.name == "Author"
    assert response.annotation is not None
    assert response.annotation.frame_number == 12
    assert [reply.body for reply in response.replies] == ["First", "Second"]
    assert response.replies[0].guest_author is not None
    assert response.replies[0].guest_author.email == "guest@example.com"
    assert response.replies[0].replies[0].body == "Nested"
    assert response.attachments[0].file_name == "root.png"
    assert response.reactions[0].count == 2
    assert response.reactions[0].reacted is True
    assert response.replies[1].attachments == []


def test_assemble_comment_response_marks_guest_reactions_unreacted() -> None:
    asset_id = uuid.uuid4()
    version_id = uuid.uuid4()
    root = _comment(asset_id, version_id, "Root")
    reaction = CommentReaction(
        id=uuid.uuid4(),
        comment_id=root.id,
        user_id=uuid.uuid4(),
        emoji="ok",
    )
    data = {
        "comments_by_parent": {},
        "annotations": {},
        "attachments": {},
        "reactions": {root.id: [reaction]},
        "users": {},
        "guests": {},
    }

    response = _assemble_comment_response(root, data)

    assert response.reactions[0].reacted is False
