import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, TypedDict
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, aliased

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user, get_optional_user
from ..models.asset import Asset, AssetType, AssetVersion, MediaFile, ProcessingStatus
from ..models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from ..models.user import User, GuestUser
from ..models.share import SharePermission
from ..schemas.comment import (
    AnnotationResponse,
    AttachmentResponse,
    AttachmentUploadRequest,
    AttachmentUploadResponse,
    AuthorInfo,
    GuestAuthorInfo,
    CommentCreate,
    CommentResponse,
    CommentUpdate,
    GuestCommentCreate,
    ReactionCreate,
    ReactionResponse,
)
from ..services import comment_export, s3_service
from ..services import avatar_service
from ..services.permissions import (
    can_access_asset,
    require_asset_access,
    resolve_share_version,
    validate_asset_in_share,
    validate_share_link_with_session,
)
from ..services.workspace_service import get_workspace_name
from ..tasks.email_tasks import send_mention_email
from ..tasks.celery_app import send_task_safe

router = APIRouter(tags=["comments"])

log = logging.getLogger(__name__)

EXPORT_FORMATS = {
    "edl": ("text/plain; charset=utf-8", "edl"),
    "fcpxml": ("application/xml", "fcpxml"),
    "premiere_xml": ("application/xml", "xml"),
    "csv": ("text/csv; charset=utf-8", "csv"),
}
_START_TC_RE = re.compile(r"^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_asset(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _get_active_version(
    db: Session,
    asset_id: uuid.UUID,
    version_id: uuid.UUID,
) -> AssetVersion:
    version = db.query(AssetVersion).filter(
        AssetVersion.id == version_id,
        AssetVersion.asset_id == asset_id,
        AssetVersion.deleted_at.is_(None),
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


def _get_comment_context(
    db: Session,
    comment_id: uuid.UUID,
    expected_asset_id: uuid.UUID | None = None,
) -> tuple[Comment, Asset]:
    query = db.query(Comment, Asset).join(
        Asset,
        Asset.id == Comment.asset_id,
    ).join(
        AssetVersion,
        AssetVersion.id == Comment.version_id,
    ).filter(
        Comment.id == comment_id,
        Comment.deleted_at.is_(None),
        Asset.deleted_at.is_(None),
        AssetVersion.deleted_at.is_(None),
        AssetVersion.asset_id == Comment.asset_id,
    )
    if expected_asset_id is not None:
        query = query.filter(Comment.asset_id == expected_asset_id)
    result = query.first()
    if not result:
        raise HTTPException(status_code=404, detail="Comment not found")
    return result


def _require_can_comment(db: Session, asset: Asset, user: User) -> None:
    if not can_access_asset(db, asset, user):
        raise HTTPException(status_code=403, detail="Comment permission required")


def _resolve_reply_target(
    db: Session,
    asset: Asset,
    parent_id: uuid.UUID,
    body_parent_id: uuid.UUID | None,
    body_version_id: uuid.UUID | None,
    *,
    public_only: bool = False,
) -> Comment:
    if body_parent_id is not None and body_parent_id != parent_id:
        raise HTTPException(status_code=400, detail="parent_id must match path parent")
    parent, _ = _get_comment_context(db, parent_id, asset.id)
    if body_version_id is not None:
        _get_active_version(db, asset.id, body_version_id)
        if body_version_id != parent.version_id:
            raise HTTPException(status_code=400, detail="version_id must match parent")
    if public_only and parent.visibility != "public":
        raise HTTPException(status_code=404, detail="Parent comment not found")
    return parent


# Stored as uploaded (no transcode), so reviewers see the exact reference clip.
_ATTACHMENT_LIMITS = {"image": 25 * 1024 * 1024, "video": 250 * 1024 * 1024}


def _normalize_content_type(content_type: str) -> str:
    return content_type.split(";", 1)[0].strip().lower()


def _renders_inline_safely(content_type: str) -> bool:
    # Bucket objects are served same-origin via nginx, so anything a browser
    # could execute (HTML, SVG, ...) must download instead of rendering.
    media_type = _normalize_content_type(content_type)
    return media_type.startswith(("image/", "video/", "audio/")) and media_type != "image/svg+xml"


def _build_attachment_response(attachment: CommentAttachment) -> AttachmentResponse:
    url = s3_service.generate_presigned_get_url(
        attachment.s3_key,
        expires_in=3600,
        download_filename=None if _renders_inline_safely(attachment.file_type) else attachment.original_filename,
    )
    return AttachmentResponse(
        id=attachment.id,
        file_name=attachment.original_filename,
        file_size=attachment.file_size_bytes,
        content_type=attachment.file_type,
        url=url,
    )


def _build_reaction_responses(
    reactions: list[CommentReaction],
    current_user_id: uuid.UUID | None,
) -> list[ReactionResponse]:
    counts: dict[str, int] = defaultdict(int)
    reacted: dict[str, bool] = defaultdict(bool)
    for r in reactions:
        counts[r.emoji] += 1
        if current_user_id and r.user_id == current_user_id:
            reacted[r.emoji] = True
    return [
        ReactionResponse(emoji=emoji, count=cnt, reacted=reacted[emoji])
        for emoji, cnt in counts.items()
    ]


class _CommentTreeData(TypedDict):
    comments_by_parent: dict[uuid.UUID, list[Comment]]
    annotations: dict[uuid.UUID, Annotation]
    attachments: dict[uuid.UUID, list[CommentAttachment]]
    reactions: dict[uuid.UUID, list[CommentReaction]]
    users: dict[uuid.UUID, User]
    guests: dict[uuid.UUID, GuestUser]


def _build_comment_response(
    comment: Comment,
    db: Session,
    current_user_id: uuid.UUID | None = None,
    depth: int = 5,
) -> CommentResponse:
    data = _fetch_comment_tree_data(
        db,
        [comment],
        depth=depth,
        asset_id=comment.asset_id,
        version_id=comment.version_id,
    )
    return _assemble_comment_response(comment, data, current_user_id=current_user_id)


def _fetch_comment_tree_data(
    db: Session,
    top_level: list[Comment],
    depth: int = 5,
    *,
    asset_id: uuid.UUID | None = None,
    version_id: uuid.UUID | None = None,
    public_only: bool = False,
) -> _CommentTreeData:
    all_comments = list(top_level)
    frontier = [comment.id for comment in top_level]
    comments_by_parent: dict[uuid.UUID, list[Comment]] = {}
    parent = aliased(Comment)

    for _ in range(depth):
        if not frontier:
            break
        query = db.query(Comment).join(
            parent,
            parent.id == Comment.parent_id,
        ).join(
            AssetVersion,
            AssetVersion.id == Comment.version_id,
        ).filter(
            parent.id.in_(frontier),
            Comment.deleted_at.is_(None),
            AssetVersion.deleted_at.is_(None),
            AssetVersion.asset_id == Comment.asset_id,
            Comment.version_id == parent.version_id,
        )
        if asset_id is not None:
            query = query.filter(Comment.asset_id == asset_id)
        if version_id is not None:
            query = query.filter(Comment.version_id == version_id)
        if public_only:
            query = query.filter(Comment.visibility == "public")
        replies = query.order_by(Comment.created_at).all()
        if not replies:
            break
        for reply in replies:
            comments_by_parent.setdefault(reply.parent_id, []).append(reply)
        all_comments.extend(replies)
        frontier = [reply.id for reply in replies]

    comment_ids = [comment.id for comment in all_comments]
    attachments: dict[uuid.UUID, list[CommentAttachment]] = {}
    reactions: dict[uuid.UUID, list[CommentReaction]] = {}
    if comment_ids:
        for attachment in db.query(CommentAttachment).filter(
            CommentAttachment.comment_id.in_(comment_ids),
        ).all():
            attachments.setdefault(attachment.comment_id, []).append(attachment)
        for reaction in db.query(CommentReaction).filter(
            CommentReaction.comment_id.in_(comment_ids),
        ).all():
            reactions.setdefault(reaction.comment_id, []).append(reaction)

    author_ids = {comment.author_id for comment in all_comments if comment.author_id}
    users = (
        {user.id: user for user in db.query(User).filter(User.id.in_(author_ids)).all()}
        if author_ids
        else {}
    )
    guest_ids = {
        comment.guest_author_id
        for comment in all_comments
        if comment.guest_author_id
    }
    guests = (
        {guest.id: guest for guest in db.query(GuestUser).filter(GuestUser.id.in_(guest_ids)).all()}
        if guest_ids
        else {}
    )

    return {
        "comments_by_parent": comments_by_parent,
        "annotations": _get_annotations_map(comment_ids, db),
        "attachments": attachments,
        "reactions": reactions,
        "users": users,
        "guests": guests,
    }


def _assemble_comment_response(
    comment: Comment,
    data: _CommentTreeData,
    current_user_id: uuid.UUID | None = None,
) -> CommentResponse:
    author_info = None
    author = data["users"].get(comment.author_id) if comment.author_id else None
    if author:
        author_info = AuthorInfo(
            id=author.id,
            name=author.name,
            avatar_url=avatar_service.effective_avatar_url(author),
        )
    guest_author_info = None
    guest = data["guests"].get(comment.guest_author_id) if comment.guest_author_id else None
    if guest:
        guest_author_info = GuestAuthorInfo(id=guest.id, name=guest.name)

    annotation = data["annotations"].get(comment.id)
    resp = CommentResponse.model_validate(comment)
    resp.author = author_info
    resp.guest_author = guest_author_info
    resp.annotation = AnnotationResponse.model_validate(annotation) if annotation else None
    resp.replies = [
        _assemble_comment_response(reply, data, current_user_id=current_user_id)
        for reply in data["comments_by_parent"].get(comment.id, [])
    ]
    resp.attachments = [
        _build_attachment_response(attachment)
        for attachment in data["attachments"].get(comment.id, [])
    ]
    resp.reactions = _build_reaction_responses(
        data["reactions"].get(comment.id, []),
        current_user_id,
    )
    return resp


def _get_annotations_map(comment_ids: list[uuid.UUID], db: Session) -> dict[uuid.UUID, Annotation]:
    """Batch-load annotations for a list of comment IDs."""
    if not comment_ids:
        return {}
    annotations = db.query(Annotation).filter(Annotation.comment_id.in_(comment_ids)).all()
    return {a.comment_id: a for a in annotations}


def _parse_mentions(body: str) -> list[str]:
    """Extract @email mentions from comment body."""
    return re.findall(r"@([\w.+-]+@[\w.-]+\.\w+)", body)


def _send_mention_emails(db: Session, comment: Comment, asset: Asset, body: str, author_name: str, mention_user_ids: list | None = None) -> None:
    """Email every @mentioned user.
    Uses explicit mention_user_ids if provided, else falls back to parsing @email from body."""
    from ..services.auth_service import get_user_by_email
    from ..config import settings

    mentioned_users = []

    if mention_user_ids:
        # Use explicit user IDs from frontend
        for uid in set(mention_user_ids):
            user = db.query(User).filter(User.id == uid).first()
            if user and user.id != comment.author_id:
                mentioned_users.append(user)
    else:
        # Fallback: parse @email from body
        emails = _parse_mentions(body)
        for email in set(emails):
            user = get_user_by_email(db, email)
            if user and user.id != comment.author_id:
                mentioned_users.append(user)

    if not mentioned_users:
        return

    workspace_name = get_workspace_name(db)
    for user in mentioned_users:
        asset_link = f"{settings.frontend_url}/projects/{asset.project_id}/assets/{asset.id}"
        send_task_safe(send_mention_email,
            to_email=user.email,
            mentioner_name=author_name,
            asset_name=asset.name,
            comment_preview=body[:200],
            asset_link=asset_link,
            workspace_name=workspace_name,
        )


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/assets/{asset_id}/comments", response_model=list[CommentResponse])
def list_comments(
    asset_id: uuid.UUID,
    version_id: Optional[uuid.UUID] = None,
    visibility: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)
    if version_id is not None:
        _get_active_version(db, asset.id, version_id)
    # Top-level comments only (parent_id is None)
    query = db.query(Comment).join(
        AssetVersion,
        AssetVersion.id == Comment.version_id,
    ).filter(
        Comment.asset_id == asset_id,
        Comment.parent_id.is_(None),
        Comment.deleted_at.is_(None),
        AssetVersion.deleted_at.is_(None),
        AssetVersion.asset_id == Comment.asset_id,
    )
    if version_id:
        query = query.filter(Comment.version_id == version_id)
    if visibility and visibility in ("public", "internal"):
        query = query.filter(Comment.visibility == visibility)
    top_level = query.order_by(Comment.created_at).all()
    data = _fetch_comment_tree_data(db, top_level, asset_id=asset.id, version_id=version_id)
    return [
        _assemble_comment_response(comment, data, current_user_id=current_user.id)
        for comment in top_level
    ]


def _merge_overlapping_cuts(db: Session, cut: Comment) -> Comment:
    """Fold every cut that overlaps or touches `cut` (same version) into one.

    The earliest cut survives and its range grows to the union; the others
    become replies on it so no note is lost (their own replies move up to the
    survivor). A folded cut with nothing to say is deleted instead of leaving
    an empty reply. Returns the survivor.
    """
    group = [cut]
    start, end = cut.timecode_start, cut.timecode_end
    while True:
        seen = {c.id for c in group}
        overlapping = [
            c for c in db.query(Comment).filter(
                Comment.asset_id == cut.asset_id,
                Comment.version_id == cut.version_id,
                Comment.parent_id.is_(None),
                Comment.is_cut.is_(True),
                Comment.deleted_at.is_(None),
                Comment.timecode_start <= end,
                Comment.timecode_end >= start,
            ).all()
            if c.id not in seen
        ]
        if not overlapping:
            break
        group.extend(overlapping)
        start = min(c.timecode_start for c in group)
        end = max(c.timecode_end for c in group)

    if len(group) == 1:
        return cut
    survivor = min(group, key=lambda c: (c.created_at is None, c.created_at or datetime.now(timezone.utc)))
    survivor.timecode_start, survivor.timecode_end = start, end
    now = datetime.now(timezone.utc)
    for folded in group:
        if folded is survivor:
            continue
        db.query(Comment).filter(Comment.parent_id == folded.id).update(
            {"parent_id": survivor.id}, synchronize_session="fetch"
        )
        has_annotation = db.query(Annotation.id).filter(Annotation.comment_id == folded.id).first() is not None
        if not folded.body.strip() and not has_annotation:
            folded.deleted_at = now
        else:
            folded.parent_id = survivor.id
            folded.is_cut = False
            folded.timecode_start = None
            folded.timecode_end = None
            folded.visibility = survivor.visibility
    return survivor


@router.post("/assets/{asset_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_comment(
    asset_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    _require_can_comment(db, asset, current_user)
    _get_active_version(db, asset.id, body.version_id)
    if body.parent_id is not None:
        raise HTTPException(status_code=400, detail="Use the reply endpoint for replies")

    comment = Comment(
        asset_id=asset_id,
        version_id=body.version_id,
        parent_id=body.parent_id,
        author_id=current_user.id,
        timecode_start=body.timecode_start,
        timecode_end=body.timecode_end,
        body=body.body,
        visibility=body.visibility or "public",
        is_cut=body.is_cut,
    )
    db.add(comment)
    db.flush()

    if body.annotation:
        annotation = Annotation(
            comment_id=comment.id,
            drawing_data=body.annotation.drawing_data,
            frame_number=body.annotation.frame_number,
        )
        db.add(annotation)

    _send_mention_emails(db, comment, asset, body.body, current_user.name, body.mention_user_ids)

    if comment.is_cut:
        db.flush()
        survivor = _merge_overlapping_cuts(db, comment)
        # A merged empty cut is gone; hand back the survivor so attachments land there
        if comment.deleted_at is not None:
            comment = survivor

    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db, current_user_id=current_user.id)


@router.post("/assets/{asset_id}/comments/{comment_id}/replies", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def reply_to_comment(
    asset_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    _require_can_comment(db, asset, current_user)
    parent = _resolve_reply_target(
        db,
        asset,
        comment_id,
        body.parent_id,
        body.version_id,
    )

    # Force body's version_id to match parent
    reply = Comment(
        asset_id=asset_id,
        version_id=parent.version_id,
        parent_id=comment_id,
        author_id=current_user.id,
        body=body.body,
        visibility=parent.visibility,
    )
    db.add(reply)
    db.flush()
    _send_mention_emails(db, reply, asset, body.body, current_user.name, body.mention_user_ids)

    db.commit()
    db.refresh(reply)
    return _build_comment_response(reply, db, current_user_id=current_user.id)


def _require_author_comment_context(
    db: Session,
    asset: Asset,
    user: User,
    share_token: Optional[str],
    share_session: Optional[str],
) -> None:
    """Own-comment mutations need a live comment path to the asset: project
    capability, or a valid comment-permission share link (logged-in viewers
    on a guest link have no project access but may edit their own words)."""
    if can_access_asset(db, asset, user):
        return
    if share_token:
        try:
            link = validate_share_link_with_session(
                db,
                share_token,
                share_session=share_session,
                current_user=user,
            )
            if link.permission != SharePermission.view:
                validate_asset_in_share(db, link, asset)
                return
        except HTTPException:
            pass
    raise HTTPException(status_code=403, detail="Comment permission required")


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
def update_comment(
    comment_id: uuid.UUID,
    body: CommentUpdate,
    share_token: Optional[str] = Query(None, alias="share_token"),
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment, asset = _get_comment_context(db, comment_id)
    if comment.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Can only edit your own comments")
    _require_author_comment_context(db, asset, current_user, share_token, share_session)
    comment.body = body.body
    comment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db, current_user_id=current_user.id)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: uuid.UUID,
    share_token: Optional[str] = Query(None, alias="share_token"),
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment, asset = _get_comment_context(db, comment_id)
    if comment.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Can only delete your own comments")
    _require_author_comment_context(db, asset, current_user, share_token, share_session)
    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/comments/{comment_id}/resolve", response_model=CommentResponse)
def resolve_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment, asset = _get_comment_context(db, comment_id)
    _require_can_comment(db, asset, current_user)
    comment.resolved = not comment.resolved
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db, current_user_id=current_user.id)


@router.post("/comments/{comment_id}/cut", response_model=CommentResponse)
def toggle_cut(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a range comment as a cut (or back). Any member: the owner often
    decides which of the editor's notes become cuts."""
    comment, asset = _get_comment_context(db, comment_id)
    _require_can_comment(db, asset, current_user)
    if not comment.is_cut and (
        comment.parent_id is not None
        or comment.timecode_start is None
        or comment.timecode_end is None
        or comment.timecode_end <= comment.timecode_start
    ):
        raise HTTPException(status_code=400, detail="Only a top-level comment with a range can be a cut")
    comment.is_cut = not comment.is_cut
    if comment.is_cut:
        db.flush()
        comment = _merge_overlapping_cuts(db, comment)
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db, current_user_id=current_user.id)


# ── Attachments ────────────────────────────────────────────────────────────────

@router.post(
    "/comments/{comment_id}/attachments",
    response_model=AttachmentUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_attachment(
    comment_id: uuid.UUID,
    body: AttachmentUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment, asset = _get_comment_context(db, comment_id)
    _require_can_comment(db, asset, current_user)

    content_type = _normalize_content_type(body.content_type)
    limit = _ATTACHMENT_LIMITS.get(content_type.split("/", 1)[0])
    if limit is None:
        raise HTTPException(status_code=422, detail="Attachments must be images or videos")
    if not 0 < body.file_size <= limit:
        raise HTTPException(status_code=413, detail=f"Attachment exceeds {limit // (1024 * 1024)} MB")
    # Generate S3 key
    key = f"comment-attachments/{comment_id}/{uuid.uuid4()}/{body.file_name}"

    # Presigned PUT the browser uploads to: must use the public endpoint
    # (the internal one is unreachable from outside the container).
    s3 = s3_service._get_presign_client()
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ContentType": content_type,
            # Signed, so the upload can't exceed the size checked above
            "ContentLength": body.file_size,
        },
        ExpiresIn=3600,
    )

    # Save attachment record
    attachment = CommentAttachment(
        comment_id=comment_id,
        file_type=content_type,
        s3_key=key,
        original_filename=body.file_name,
        file_size_bytes=body.file_size,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    return AttachmentUploadResponse(
        upload_url=upload_url,
        attachment_id=attachment.id,
        key=key,
    )


@router.delete(
    "/comments/{comment_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_attachment(
    comment_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment, asset = _get_comment_context(db, comment_id)

    attachment = db.query(CommentAttachment).filter(
        CommentAttachment.id == attachment_id,
        CommentAttachment.comment_id == comment_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    _require_can_comment(db, asset, current_user)

    # Delete from S3
    try:
        s3_service.delete_object(attachment.s3_key)
    except Exception:
        pass  # Best-effort S3 deletion

    db.delete(attachment)
    db.commit()


# ── Reactions ──────────────────────────────────────────────────────────────────

@router.post("/comments/{comment_id}/react", status_code=status.HTTP_204_NO_CONTENT)
def toggle_reaction(
    comment_id: uuid.UUID,
    body: ReactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment, asset = _get_comment_context(db, comment_id)
    _require_can_comment(db, asset, current_user)

    existing = db.query(CommentReaction).filter(
        CommentReaction.comment_id == comment_id,
        CommentReaction.user_id == current_user.id,
        CommentReaction.emoji == body.emoji,
    ).first()

    if existing:
        db.delete(existing)
    else:
        reaction = CommentReaction(
            comment_id=comment_id,
            user_id=current_user.id,
            emoji=body.emoji,
        )
        db.add(reaction)

    db.commit()


# ── Export ─────────────────────────────────────────────────────────────────────

@router.get("/assets/{asset_id}/comments/export")
def export_comments(
    asset_id: uuid.UUID,
    format: str = Query(...),
    version_id: Optional[uuid.UUID] = Query(default=None),
    fps: Optional[float] = Query(default=None, gt=0),
    start_tc: str = Query(default="01:00:00:00"),
    include_resolved: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a version's comments as NLE timeline markers:
    Resolve marker EDL, FCPXML (Final Cut), FCP7 XML (Premiere), or CSV."""
    if format not in EXPORT_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format '{format}'. Use one of: {', '.join(EXPORT_FORMATS)}",
        )

    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)

    if version_id is not None:
        version = db.query(AssetVersion).filter(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset.id,
            AssetVersion.deleted_at.is_(None),
        ).first()
    else:
        version = db.query(AssetVersion).filter(
            AssetVersion.asset_id == asset.id,
            AssetVersion.processing_status == ProcessingStatus.ready,
            AssetVersion.deleted_at.is_(None),
        ).order_by(AssetVersion.version_number.desc()).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    spec = None
    media_file = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()
    if format == "csv":
        stored_fps = media_file.fps if media_file else None
        if fps or stored_fps:
            spec = comment_export.snap_fps(fps or stored_fps)  # None is fine for CSV
    else:
        if asset.asset_type != AssetType.video:
            raise HTTPException(
                status_code=422,
                detail="EDL/FCPXML/Premiere XML export is only available for video assets; use format=csv",
            )
        effective_fps = fps or (media_file.fps if media_file else None)
        if not effective_fps:
            raise HTTPException(status_code=422, detail={
                "code": "fps_required",
                "message": "Frame rate unknown for this version; pass ?fps= "
                           "(e.g. 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60)",
            })
        spec = comment_export.snap_fps(effective_fps)
        if spec is None:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported frame rate {effective_fps}; supported: "
                       + ", ".join(str(round(s.fps, 3)) for s in comment_export.FPS_TABLE),
            )
        if format == "edl":
            if not _START_TC_RE.match(start_tc):
                raise HTTPException(status_code=422, detail="start_tc must be HH:MM:SS:FF")
            hh, mm, ss, ff = (int(p) for p in re.split(r"[:;]", start_tc))
            if not (hh <= 23 and mm < 60 and ss < 60 and ff < spec.timebase):
                raise HTTPException(status_code=422, detail="start_tc out of range for the frame rate")

    comments = db.query(Comment).filter(
        Comment.version_id == version.id,
        Comment.deleted_at.is_(None),
    ).order_by(Comment.created_at.asc()).all()

    user_ids = {c.author_id for c in comments if c.author_id}
    guest_ids = {c.guest_author_id for c in comments if c.guest_author_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    guests = {g.id: g for g in db.query(GuestUser).filter(GuestUser.id.in_(guest_ids)).all()} if guest_ids else {}

    rows = []
    for c in comments:
        author = users.get(c.author_id) or guests.get(c.guest_author_id)
        rows.append(comment_export.CommentRow(
            id=str(c.id),
            parent_id=str(c.parent_id) if c.parent_id else None,
            author_name=(author.name or author.email) if author else "Unknown",
            author_email=author.email if author else "",
            body=c.body,
            timecode_start=c.timecode_start,
            timecode_end=c.timecode_end,
            resolved=bool(c.resolved),
            created_at=c.created_at,
            version_number=version.version_number,
        ))

    duration_frames = 0
    if spec is not None and media_file is not None and media_file.duration_seconds:
        duration_frames = comment_export.seconds_to_frames(media_file.duration_seconds, spec)

    if format == "csv":
        if not include_resolved:
            rows = [r for r in rows if not r.resolved]
        content = "﻿" + comment_export.to_csv(rows, spec)  # BOM for Excel
    else:
        markers = comment_export.build_markers(rows, spec, include_resolved)
        if format == "edl":
            if len(markers) > comment_export.EDL_MAX_EVENTS:
                log.warning(
                    "EDL export for asset %s truncated: %d markers exceed EDL_MAX_EVENTS=%d, "
                    "%d dropped",
                    asset_id, len(markers), comment_export.EDL_MAX_EVENTS,
                    len(markers) - comment_export.EDL_MAX_EVENTS,
                )
            content = comment_export.to_edl(
                markers, spec, comment_export.tc_to_frames(start_tc, spec), asset.name)
        elif format == "fcpxml":
            content = comment_export.to_fcpxml(markers, spec, asset.name, duration_frames)
        else:
            content = comment_export.to_premiere_xml(markers, spec, asset.name, duration_frames)

    media_type, ext = EXPORT_FORMATS[format]
    safe_name = re.sub(r"[^\w\-. ]", "_", asset.name, flags=re.ASCII).strip() or "asset"
    filename = f"{safe_name}_v{version.version_number}_comments.{ext}"
    utf8_name = quote(f"{asset.name}_v{version.version_number}_comments.{ext}", safe="")
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{utf8_name}'
            )
        },
    )


# ── Guest comments (via share link) ───────────────────────────────────────────

@router.get("/share/{token}/comments")
def list_share_comments(
    token: str,
    asset_id: Optional[uuid.UUID] = None,
    version_id: Optional[uuid.UUID] = None,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — list comments for a shared asset. No auth required.
    For folder shares, pass asset_id as query param to get comments for a specific asset."""
    link = validate_share_link_with_session(
        db,
        token,
        share_session=share_session,
        current_user=current_user,
    )

    # Determine the asset_id to list comments for
    target_asset_id = link.asset_id or asset_id
    if not target_asset_id:
        return []
    asset = _get_asset(db, target_asset_id)
    validate_asset_in_share(db, link, asset)
    # Without show_versions, only the newest version's comments are visible
    if version_id is not None or not link.show_versions:
        version_id = resolve_share_version(db, link, asset, version_id).id

    # Get top-level comments — reuse same format as authenticated endpoint
    query = db.query(Comment).join(
        AssetVersion,
        AssetVersion.id == Comment.version_id,
    ).filter(
        Comment.asset_id == asset.id,
        Comment.parent_id.is_(None),
        Comment.deleted_at.is_(None),
        Comment.visibility == "public",
        AssetVersion.deleted_at.is_(None),
        AssetVersion.asset_id == Comment.asset_id,
    )
    if version_id is not None:
        query = query.filter(Comment.version_id == version_id)
    top_level = query.order_by(Comment.created_at).all()

    data = _fetch_comment_tree_data(
        db,
        top_level,
        asset_id=asset.id,
        version_id=version_id,
        public_only=True,
    )
    return [_assemble_comment_response(comment, data) for comment in top_level]


@router.delete("/share/{token}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_share_comment(
    token: str,
    comment_id: uuid.UUID,
    guest_email: Optional[str] = Query(None, alias="guest_email"),
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — a viewer deletes their own comment on a shared asset.

    Logged-in viewers fall back to the authenticated ownership check; guests
    must prove authorship by knowing the email they commented with (it is
    never exposed in public comment payloads).
    """
    link = validate_share_link_with_session(
        db,
        token,
        share_session=share_session,
        current_user=current_user,
    )
    if link.permission == SharePermission.view:
        raise HTTPException(status_code=403, detail="This share link does not allow commenting")

    comment, asset = _get_comment_context(db, comment_id)
    validate_asset_in_share(db, link, asset)

    if current_user:
        if comment.author_id != current_user.id:
            raise HTTPException(status_code=403, detail="Can only delete your own comments")
    else:
        guest = (
            db.get(GuestUser, comment.guest_author_id)
            if comment.guest_author_id
            else None
        )
        if not guest or not guest_email or guest.email != guest_email.strip().lower():
            raise HTTPException(status_code=403, detail="Can only delete your own comments")

    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/share/{token}/comment", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def guest_comment(
    token: str,
    body: GuestCommentCreate,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    link = validate_share_link_with_session(
        db,
        token,
        share_session=share_session,
        current_user=current_user,
    )

    # Check share link permission allows commenting
    if link.permission == SharePermission.view:
        raise HTTPException(status_code=403, detail="This share link does not allow commenting")

    # Resolve asset_id: from body, link, or error
    target_asset_id = body.asset_id or link.asset_id
    if not target_asset_id:
        raise HTTPException(status_code=400, detail="asset_id is required for folder shares")
    asset = _get_asset(db, target_asset_id)
    validate_asset_in_share(db, link, asset)

    parent = None
    if body.parent_id is not None:
        parent = _resolve_reply_target(
            db,
            asset,
            body.parent_id,
            body.parent_id,
            body.version_id,
            public_only=True,
        )
        requested_version_id = parent.version_id
    else:
        requested_version_id = body.version_id
    # Guests may only comment on a version the link shows them
    version_id = resolve_share_version(db, link, asset, requested_version_id).id

    # Determine author: logged-in user or guest
    author_id = None
    guest_author_id = None
    if current_user:
        author_id = current_user.id
    else:
        if not body.guest_email or not body.guest_name:
            raise HTTPException(status_code=400, detail="guest_email and guest_name required for anonymous comments")
        guest_email = body.guest_email.lower()
        guest = db.query(GuestUser).filter(GuestUser.email == guest_email).first()
        if not guest:
            guest = GuestUser(email=guest_email, name=body.guest_name)
            db.add(guest)
            db.flush()
        guest_author_id = guest.id

    comment = Comment(
        asset_id=asset.id,
        version_id=version_id,
        parent_id=parent.id if parent else None,
        author_id=author_id,
        guest_author_id=guest_author_id,
        timecode_start=body.timecode_start,
        timecode_end=body.timecode_end,
        body=body.body,
        visibility=parent.visibility if parent else "public",
    )
    db.add(comment)
    db.flush()

    if body.annotation:
        annotation = Annotation(
            comment_id=comment.id,
            drawing_data=body.annotation.drawing_data,
            frame_number=body.annotation.frame_number,
        )
        db.add(annotation)

    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db)
