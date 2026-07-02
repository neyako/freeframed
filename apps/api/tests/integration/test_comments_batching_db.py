from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import event

from apps.api.models.asset import Asset, AssetType, AssetVersion, ProcessingStatus
from apps.api.models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from apps.api.models.user import GuestUser
from apps.api.routers.comments import _assemble_comment_response, _fetch_comment_tree_data


def _add_asset_and_version(db, project_id, creator_id) -> tuple[Asset, AssetVersion]:
    asset = Asset(
        project_id=project_id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.ready,
        created_by=creator_id,
    )
    db.add(version)
    db.flush()
    return asset, version


def _add_comment(db, asset: Asset, version: AssetVersion, body: str) -> Comment:
    comment = Comment(
        asset_id=asset.id,
        version_id=version.id,
        body=body,
        visibility="public",
    )
    db.add(comment)
    db.flush()
    return comment


def test_comment_tree_batching_preserves_seeded_response_contract(
    db,
    make_project,
    make_user,
) -> None:
    project, owner = make_project()
    owner.name = "Owner User"
    owner.avatar_url = "https://example.test/owner.png"
    reviewer = make_user()
    reviewer.name = "Reviewer User"
    asset, version = _add_asset_and_version(db, project.id, owner.id)
    top_one = _add_comment(db, asset, version, "One")
    top_one.author_id = owner.id
    top_one.created_at = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    top_two = _add_comment(db, asset, version, "Two")
    top_two.author_id = reviewer.id
    top_two.created_at = datetime(2026, 1, 1, 12, 1, tzinfo=timezone.utc)
    guest = GuestUser(email="guest@example.com", name="Guest")
    db.add(guest)
    db.flush()
    top_three = _add_comment(db, asset, version, "Three")
    top_three.guest_author_id = guest.id
    top_three.created_at = datetime(2026, 1, 1, 12, 2, tzinfo=timezone.utc)
    reply = _add_comment(db, asset, version, "Reply")
    reply.parent_id = top_one.id
    reply.author_id = reviewer.id
    reply.created_at = datetime(2026, 1, 1, 12, 3, tzinfo=timezone.utc)
    nested = _add_comment(db, asset, version, "Nested")
    nested.parent_id = reply.id
    nested.guest_author_id = guest.id
    nested.created_at = datetime(2026, 1, 1, 12, 4, tzinfo=timezone.utc)
    deleted_reply = _add_comment(db, asset, version, "Deleted")
    deleted_reply.parent_id = top_one.id
    deleted_reply.deleted_at = datetime.now(timezone.utc)
    db.add(
        Annotation(
            comment_id=top_one.id,
            drawing_data={"objects": []},
            frame_number=11,
        )
    )
    db.add(
        Annotation(
            comment_id=reply.id,
            drawing_data={"objects": [{"x": 1}]},
            carousel_position=3,
        )
    )
    db.add(
        CommentAttachment(
            comment_id=top_one.id,
            file_type="image/png",
            s3_key="attachments/root.png",
            original_filename="root.png",
            file_size_bytes=128,
        )
    )
    db.add(CommentReaction(comment_id=top_one.id, user_id=reviewer.id, emoji="ok"))
    db.add(CommentReaction(comment_id=top_one.id, user_id=owner.id, emoji="ok"))
    db.add(CommentReaction(comment_id=reply.id, user_id=owner.id, emoji="seen"))
    db.flush()

    top_level = (
        db.query(Comment)
        .filter(
            Comment.asset_id == asset.id,
            Comment.parent_id.is_(None),
            Comment.deleted_at.is_(None),
        )
        .order_by(Comment.created_at)
        .all()
    )

    with patch(
        "apps.api.routers.comments.s3_service.generate_presigned_get_url",
        return_value="https://example.test/root.png",
    ):
        data = _fetch_comment_tree_data(db, top_level)
        batched = [
            _assemble_comment_response(comment, data, current_user_id=reviewer.id)
            for comment in top_level
        ]

    assert [item.id for item in batched] == [top_one.id, top_two.id, top_three.id]
    assert [reply_item.id for reply_item in batched[0].replies] == [reply.id]
    assert [reply_item.id for reply_item in batched[0].replies[0].replies] == [
        nested.id
    ]
    assert [reply_item.body for reply_item in batched[0].replies] == ["Reply"]
    assert batched[0].annotation is not None
    assert batched[0].annotation.drawing_data == {"objects": []}
    assert batched[0].annotation.frame_number == 11
    reply_response = batched[0].replies[0]
    assert reply_response.annotation is not None
    assert reply_response.annotation.drawing_data == {"objects": [{"x": 1}]}
    assert reply_response.annotation.carousel_position == 3
    assert len(batched[0].attachments) == 1
    assert batched[0].attachments[0].file_name == "root.png"
    assert batched[0].attachments[0].file_size == 128
    assert batched[0].attachments[0].content_type == "image/png"
    assert batched[0].attachments[0].url == "https://example.test/root.png"
    assert batched[0].author is not None
    assert batched[0].author.id == owner.id
    assert batched[0].author.name == "Owner User"
    assert batched[0].author.avatar_url == "https://example.test/owner.png"
    assert batched[2].guest_author is not None
    assert batched[2].guest_author.id == guest.id
    assert batched[2].guest_author.name == "Guest"
    assert batched[2].guest_author.email == "guest@example.com"
    root_reactions = {reaction.emoji: reaction for reaction in batched[0].reactions}
    assert root_reactions["ok"].count == 2
    assert root_reactions["ok"].reacted is True
    reply_reactions = {reaction.emoji: reaction for reaction in reply_response.reactions}
    assert reply_reactions["seen"].count == 1
    assert reply_reactions["seen"].reacted is False
    assert "Deleted" not in {reply_item.body for reply_item in batched[0].replies}


def test_comment_tree_batching_uses_bounded_query_count(
    db,
    migrated_engine,
    make_project,
) -> None:
    project, owner = make_project()
    asset, version = _add_asset_and_version(db, project.id, owner.id)
    for index in range(20):
        top = _add_comment(db, asset, version, f"Top {index}")
        top.author_id = owner.id
        reply = _add_comment(db, asset, version, f"Reply {index}")
        reply.parent_id = top.id
    db.flush()
    statements: list[str] = []

    def count_statement(
        _conn,
        _cursor,
        statement: str,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        statements.append(statement)

    event.listen(migrated_engine, "before_cursor_execute", count_statement)
    try:
        top_level = (
            db.query(Comment)
            .filter(
                Comment.asset_id == asset.id,
                Comment.parent_id.is_(None),
                Comment.deleted_at.is_(None),
            )
            .order_by(Comment.created_at)
            .all()
        )
        data = _fetch_comment_tree_data(db, top_level)
        [_assemble_comment_response(comment, data, current_user_id=owner.id) for comment in top_level]
    finally:
        event.remove(migrated_engine, "before_cursor_execute", count_statement)

    assert len(statements) <= 10
