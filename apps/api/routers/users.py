from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from ..database import get_db
from ..schemas.auth import AdminUserResponse, UserResponse, InviteRequest, UpdateProfileRequest
from ..models.project import ProjectMember
from ..models.share import AssetShare
from ..models.user import User, UserStatus
from ..middleware.auth import get_current_user
from ..services.auth_service import hash_password, get_user_by_email, revoke_user_refresh_tokens
from ..tasks.email_tasks import send_invite_email
from ..tasks.celery_app import send_task_safe
from ..config import settings
from ..services.workspace_service import get_workspace_name

router = APIRouter(prefix="/users", tags=["users"])

@router.get("", response_model=list[UserResponse])
def get_users_batch(
    ids: str = Query(..., description="Comma-separated user IDs"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get basic user info for a batch of user IDs. Any authenticated user can call this."""
    try:
        user_ids = [uuid.UUID(uid.strip()) for uid in ids.split(",") if uid.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID format")
    if len(user_ids) > 100:
        raise HTTPException(status_code=400, detail="Max 100 user IDs per request")
    users = db.query(User).filter(User.id.in_(user_ids), User.deleted_at.is_(None)).all()
    return users


@router.get("/search", response_model=list[UserResponse])
def search_users(
    q: str = Query(..., min_length=1, description="Search by name or email"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search users by name or email. Returns up to 10 matching users."""
    pattern = f"%{q}%"
    users = db.query(User).filter(
        User.deleted_at.is_(None),
        (User.name.ilike(pattern) | User.email.ilike(pattern)),
    ).limit(10).all()
    return users


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

@router.post("/invite", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
def invite_user(body: InviteRequest, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    # Look up including soft-deleted rows: the unique email constraint still
    # holds them, so a deleted user must be resurrected, not re-inserted.
    existing = db.query(User).filter(User.email == body.email).first()
    if existing and existing.deleted_at is None:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Generate invite token
    invite_token = secrets.token_urlsafe(48)
    invite_expires = datetime.now(timezone.utc) + timedelta(days=7)
    workspace_name = get_workspace_name(db)

    if existing:
        # Resurrect the soft-deleted row as a fresh invite
        user = existing
        user.deleted_at = None
        user.name = body.name
        user.status = UserStatus.pending_invite
        user.password_hash = None
        user.is_superadmin = False
        user.invited_by_id = current_user.id
        user.invite_token = invite_token
        user.invite_token_expires_at = invite_expires
    else:
        user = User(
            email=body.email,
            name=body.name,
            status=UserStatus.pending_invite,
            invited_by_id=current_user.id,
            invite_token=invite_token,
            invite_token_expires_at=invite_expires,
        )
        db.add(user)
    db.commit()
    db.refresh(user)
    
    # Send invite email
    invite_url = f"{settings.frontend_url}/invite/{invite_token}"
    send_task_safe(
        send_invite_email,
        user.email,
        current_user.name or "Admin",
        workspace_name,
        invite_url,
        workspace_name=workspace_name,
    )
    
    return user

@router.patch("/{user_id}", response_model=UserResponse)
def update_user(user_id: uuid.UUID, body: UpdateProfileRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Update user profile. Users can update their own profile."""
    if current_user.id != user_id and not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Can only update your own profile")
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.name is not None:
        user.name = body.name.strip()
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url
    db.commit()
    db.refresh(user)
    return user

@router.patch("/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user(user_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = UserStatus.deactivated
    revoke_user_refresh_tokens(db, user.id)
    db.commit()
    db.refresh(user)
    return user

@router.patch("/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(user_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = UserStatus.active
    db.commit()
    db.refresh(user)
    return user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    revoke_user_refresh_tokens(db, user.id)
    now = datetime.now(timezone.utc)
    user.deleted_at = now
    db.query(ProjectMember).filter(
        ProjectMember.user_id == user.id,
        ProjectMember.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
    db.query(AssetShare).filter(
        AssetShare.shared_with_user_id == user.id,
        AssetShare.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
    db.commit()
