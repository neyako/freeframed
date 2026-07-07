import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, TypedDict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user, get_optional_user
from ..middleware.share_auth import get_share_link
from ..models.asset import Asset
from ..models.project import ProjectMember, ProjectRole
from ..models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from ..models.activity import Mention, Notification, NotificationType, ActivityLog, ActivityAction
from ..models.user import User, GuestUser
from ..models.share import ShareLink, ShareLinkActivity, ShareActivityAction, SharePermission
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
from ..services import s3_service
from ..services.permissions import (
    require_asset_access,
    validate_asset_in_share,
    validate_share_link_with_session,
)
from ..services.workspace_service import get_workspace_name
from ..tasks.email_tasks import send_mention_email, send_comment_email
from ..tasks.celery_app import send_task_safe

router = APIRouter(tags=["comments"])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_asset(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _get_comment(db: Session, comment_id: uuid.UUID) -> Comment:
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


def _build_attachment_response(attachment: CommentAttachment) -> AttachmentResponse:
    url = s3_service.generate_presigned_get_url(attachment.s3_key, expires_in=3600)
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
    data = _fetch_comment_tree_data(db, [comment], depth=depth)
    return _assemble_comment_response(comment, data, current_user_id=current_user_id)


def _fetch_comment_tree_data(
    db: Session,
    top_level: list[Comment],
    depth: int = 5,
) -> _CommentTreeData:
    all_comments = list(top_level)
    frontier = [comment.id for comment in top_level]
    comments_by_parent: dict[uuid.UUID, list[Comment]] = {}

    for _ in range(depth):
        if not frontier:
            break
        replies = db.query(Comment).filter(
            Comment.parent_id.in_(frontier),
            Comment.deleted_at.is_(None),
        ).order_by(Comment.created_at).all()
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
        author_info = AuthorInfo(id=author.id, name=author.name, avatar_url=author.avatar_url)
    guest_author_info = None
    guest = data["guests"].get(comment.guest_author_id) if comment.guest_author_id else None
    if guest:
        guest_author_info = GuestAuthorInfo(id=guest.id, name=guest.name, email=guest.email)

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


def _create_mentions(db: Session, comment: Comment, asset: Asset, body: str, author_name: str, mention_user_ids: list | None = None) -> None:
    """Create Mention + Notification records and send emails.
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
        mention = Mention(comment_id=comment.id, mentioned_user_id=user.id)
        db.add(mention)
        notif = Notification(
            user_id=user.id,
            type=NotificationType.mention,
            asset_id=asset.id,
            comment_id=comment.id,
        )
        db.add(notif)

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
    # Top-level comments only (parent_id is None)
    query = db.query(Comment).filter(
        Comment.asset_id == asset_id,
        Comment.parent_id.is_(None),
        Comment.deleted_at.is_(None),
    )
    if version_id:
        query = query.filter(Comment.version_id == version_id)
    if visibility and visibility in ("public", "internal"):
        query = query.filter(Comment.visibility == visibility)
    top_level = query.order_by(Comment.created_at).all()
    data = _fetch_comment_tree_data(db, top_level)
    return [
        _assemble_comment_response(comment, data, current_user_id=current_user.id)
        for comment in top_level
    ]


@router.post("/assets/{asset_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_comment(
    asset_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)

    comment = Comment(
        asset_id=asset_id,
        version_id=body.version_id,
        parent_id=body.parent_id,
        author_id=current_user.id,
        timecode_start=body.timecode_start,
        timecode_end=body.timecode_end,
        body=body.body,
        visibility=body.visibility or "public",
    )
    db.add(comment)
    db.flush()

    if body.annotation:
        annotation = Annotation(
            comment_id=comment.id,
            drawing_data=body.annotation.drawing_data,
            frame_number=body.annotation.frame_number,
            carousel_position=body.annotation.carousel_position,
        )
        db.add(annotation)

    _create_mentions(db, comment, asset, body.body, current_user.name, body.mention_user_ids)

    # Notify asset creator about the comment (unless they're the commenter)
    if asset.created_by and asset.created_by != current_user.id:
        db.add(Notification(
            user_id=asset.created_by,
            type=NotificationType.comment,
            asset_id=asset_id,
            comment_id=comment.id,
        ))

    # Activity log
    activity = ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.commented)
    db.add(activity)

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
    require_asset_access(db, asset, current_user)
    parent = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent comment not found")

    # Force body's version_id to match parent
    reply = Comment(
        asset_id=asset_id,
        version_id=parent.version_id,
        parent_id=comment_id,
        author_id=current_user.id,
        body=body.body,
    )
    db.add(reply)
    db.flush()
    _create_mentions(db, reply, asset, body.body, current_user.name, body.mention_user_ids)

    # Notify parent comment author about the reply (unless they're the replier)
    if parent.author_id and parent.author_id != current_user.id:
        db.add(Notification(
            user_id=parent.author_id,
            type=NotificationType.comment,
            asset_id=asset_id,
            comment_id=reply.id,
        ))

    db.commit()
    db.refresh(reply)
    return _build_comment_response(reply, db, current_user_id=current_user.id)


@router.patch("/comments/{comment_id}", response_model=CommentResponse)
def update_comment(
    comment_id: uuid.UUID,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Allow comment owner or project owner to edit
    if comment.author_id != current_user.id:
        asset = _get_asset(db, comment.asset_id)
        member = db.query(ProjectMember).filter(
            ProjectMember.project_id == asset.project_id,
            ProjectMember.user_id == current_user.id,
            ProjectMember.role == ProjectRole.owner,
            ProjectMember.deleted_at.is_(None),
        ).first()
        if not member:
            raise HTTPException(status_code=403, detail="Can only edit your own comments")
    comment.body = body.body
    comment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment, db, current_user_id=current_user.id)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Allow comment owner or project owner to delete
    if comment.author_id != current_user.id:
        asset = _get_asset(db, comment.asset_id)
        member = db.query(ProjectMember).filter(
            ProjectMember.project_id == asset.project_id,
            ProjectMember.user_id == current_user.id,
            ProjectMember.role == ProjectRole.owner,
            ProjectMember.deleted_at.is_(None),
        ).first()
        if not member:
            raise HTTPException(status_code=403, detail="Can only delete your own comments")
    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/comments/{comment_id}/resolve", response_model=CommentResponse)
def resolve_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.deleted_at.is_(None)).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    asset = _get_asset(db, comment.asset_id)
    require_asset_access(db, asset, current_user)
    comment.resolved = not comment.resolved
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
    comment = _get_comment(db, comment_id)
    asset = _get_asset(db, comment.asset_id)
    require_asset_access(db, asset, current_user)

    # Generate S3 key
    key = f"comment-attachments/{comment_id}/{uuid.uuid4()}/{body.file_name}"

    # Generate presigned PUT URL
    s3 = s3_service.get_s3_client()
    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ContentType": body.content_type,
        },
        ExpiresIn=3600,
    )

    # Save attachment record
    attachment = CommentAttachment(
        comment_id=comment_id,
        file_type=body.content_type,
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
    comment = _get_comment(db, comment_id)
    asset = _get_asset(db, comment.asset_id)

    attachment = db.query(CommentAttachment).filter(
        CommentAttachment.id == attachment_id,
        CommentAttachment.comment_id == comment_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    # Must be comment author OR project owner/editor
    from ..models.project import ProjectRole
    from ..services.permissions import get_project_member
    is_comment_author = comment.author_id == current_user.id
    if not is_comment_author:
        pm = get_project_member(db, asset.project_id, current_user.id)
        if not pm or pm.role not in (ProjectRole.owner, ProjectRole.editor):
            raise HTTPException(status_code=403, detail="Not authorized to delete this attachment")

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
    comment = _get_comment(db, comment_id)
    asset = _get_asset(db, comment.asset_id)
    require_asset_access(db, asset, current_user)

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


@router.get("/comments/{comment_id}/reactions", response_model=list[ReactionResponse])
def list_reactions(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = _get_comment(db, comment_id)
    asset = _get_asset(db, comment.asset_id)
    require_asset_access(db, asset, current_user)

    reactions_raw = db.query(CommentReaction).filter(
        CommentReaction.comment_id == comment_id,
    ).all()
    return _build_reaction_responses(reactions_raw, current_user.id)


# ── Deep link ──────────────────────────────────────────────────────────────────

@router.get("/assets/{asset_id}/comments/{comment_id}/link")
def comment_deep_link(
    asset_id: uuid.UUID,
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)
    # Verify comment belongs to this asset
    comment = db.query(Comment).filter(
        Comment.id == comment_id,
        Comment.asset_id == asset_id,
        Comment.deleted_at.is_(None),
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    url = f"{settings.frontend_url}/assets/{asset_id}?comment={comment_id}"
    return {"url": url}


# ── Guest comments (via share link) ───────────────────────────────────────────

@router.get("/share/{token}/comments")
def list_share_comments(
    token: str,
    asset_id: Optional[uuid.UUID] = None,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — list comments for a shared asset. No auth required.
    For folder/project shares, pass asset_id as query param to get comments for a specific asset."""
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

    # Get top-level comments — reuse same format as authenticated endpoint
    top_level = db.query(Comment).filter(
        Comment.asset_id == asset.id,
        Comment.parent_id.is_(None),
        Comment.deleted_at.is_(None),
    ).order_by(Comment.created_at).all()

    data = _fetch_comment_tree_data(db, top_level)
    return [_assemble_comment_response(comment, data) for comment in top_level]


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
        raise HTTPException(status_code=400, detail="asset_id is required for folder/project shares")
    asset = _get_asset(db, target_asset_id)
    validate_asset_in_share(db, link, asset)

    # Resolve version_id: use provided or get latest ready version
    version_id = body.version_id
    if not version_id:
        from ..models.asset import AssetVersion, ProcessingStatus
        latest = db.query(AssetVersion).filter(
            AssetVersion.asset_id == asset.id,
            AssetVersion.deleted_at.is_(None),
            AssetVersion.processing_status == ProcessingStatus.ready,
        ).order_by(AssetVersion.version_number.desc()).first()
        if latest:
            version_id = latest.id
        else:
            raise HTTPException(status_code=400, detail="No ready version found for this asset")

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
        parent_id=body.parent_id,
        author_id=author_id,
        guest_author_id=guest_author_id,
        timecode_start=body.timecode_start,
        timecode_end=body.timecode_end,
        body=body.body,
    )
    db.add(comment)
    db.flush()

    # Parse mentions (guest can mention registered users)
    emails = _parse_mentions(body.body)
    for email in set(emails):
        from ..services.auth_service import get_user_by_email
        user = get_user_by_email(db, email)
        if user:
            mention = Mention(comment_id=comment.id, mentioned_user_id=user.id)
            db.add(mention)
            notif = Notification(
                user_id=user.id,
                type=NotificationType.mention,
                asset_id=asset.id,
                comment_id=comment.id,
            )
            db.add(notif)

    if body.annotation:
        annotation = Annotation(
            comment_id=comment.id,
            drawing_data=body.annotation.drawing_data,
            frame_number=body.annotation.frame_number,
            carousel_position=body.annotation.carousel_position,
        )
        db.add(annotation)

    db.commit()
    db.refresh(comment)

    # Log share link activity
    actor_email = current_user.email if current_user else (body.guest_email or "anonymous")
    actor_name = current_user.name if current_user else body.guest_name
    activity = ShareLinkActivity(
        share_link_id=link.id,
        action=ShareActivityAction.commented,
        actor_email=actor_email,
        actor_name=actor_name,
        asset_id=asset.id,
        asset_name=asset.name,
    )
    db.add(activity)
    db.commit()

    return _build_comment_response(comment, db)
