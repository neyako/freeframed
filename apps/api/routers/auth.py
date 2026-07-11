from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from ..database import get_db
from ..schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse,
    RefreshRequest, UserResponse, InviteRequest,
    AcceptInviteRequest, InviteInfoResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
)
from ..config import settings
from ..middleware.rate_limit import rate_limit
from ..services.auth_service import (
    REFRESH_COOKIE,
    clear_auth_cookies,
    hash_password, verify_password,
    create_access_token,
    get_user_by_email, get_user_by_id,
    issue_refresh_token,
    revoke_refresh_token,
    revoke_user_refresh_tokens,
    rotate_refresh_token,
    set_auth_cookies,
)
from ..services.redis_service import (
    delete_password_reset_token,
    get_user_id_from_password_reset_token,
    store_password_reset_token,
)
from ..tasks.celery_app import send_task_safe
from ..tasks.email_tasks import send_invite_email, send_password_reset_email
from ..models.user import User, UserStatus
from ..middleware.auth import get_current_user
from ..services.workspace_service import get_workspace_name

router = APIRouter(prefix="/auth", tags=["auth"])


def _generate_invite_token() -> str:
    """Generate a secure invite token."""
    return secrets.token_urlsafe(48)


@router.get("/invite/{token}", response_model=InviteInfoResponse)
def get_invite_info(token: str, db: Session = Depends(get_db)):
    """Get info about an invite token (for the set-password screen)."""
    user = db.query(User).filter(
        User.invite_token == token,
        User.deleted_at.is_(None),
    ).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="Invalid invite link")
    
    if user.invite_token_expires_at and user.invite_token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite link expired")
    
    inviter_name = None
    if user.invited_by_id:
        inviter = db.query(User).filter(
            User.id == user.invited_by_id,
            User.deleted_at.is_(None),
        ).first()
        if inviter:
            inviter_name = inviter.name

    return InviteInfoResponse(
        email=user.email,
        name=user.name,
        org_name=get_workspace_name(db),
        inviter_name=inviter_name,
    )


@router.post("/accept-invite", response_model=TokenResponse)
def accept_invite(
    body: AcceptInviteRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Accept invite and set password. Email is already verified via invite."""
    user = db.query(User).filter(
        User.invite_token == body.token,
        User.deleted_at.is_(None),
    ).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="Invalid invite link")
    
    if user.invite_token_expires_at and user.invite_token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite link expired")
    
    # Set password and activate user
    user.password_hash = hash_password(body.password)
    user.email_verified = True  # Invited users are pre-verified
    user.status = UserStatus.active
    user.invite_token = None
    user.invite_token_expires_at = None
    revoke_user_refresh_tokens(db, user.id)
    refresh = issue_refresh_token(db, user.id)
    access = create_access_token(str(user.id))
    set_auth_cookies(response, access, refresh)
    db.commit()
    
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        needs_password=False,
    )


@router.post("/forgot-password", dependencies=[Depends(rate_limit("forgot_password", 5, 900))])
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    detail = "If that email is registered, a reset link has been sent."
    user = get_user_by_email(db, body.email)
    if (
        user
        and user.deleted_at is None
        and user.status != UserStatus.deactivated
        and user.password_hash is not None
    ):
        token = secrets.token_urlsafe(48)
        store_password_reset_token(token, str(user.id))
        reset_url = f"{settings.frontend_url}/reset-password/{token}"
        send_task_safe(
            send_password_reset_email,
            user.email,
            reset_url,
            workspace_name=get_workspace_name(db),
        )

    return {"detail": detail}


@router.post("/reset-password", response_model=TokenResponse)
def reset_password(
    body: ResetPasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user_id = get_user_id_from_password_reset_token(body.token)
    if user_id is None:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    user = get_user_by_id(db, user_uuid)
    if not user or user.deleted_at is not None or user.status == UserStatus.deactivated:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    delete_password_reset_token(body.token)
    user.password_hash = hash_password(body.password)
    user.email_verified = True
    revoke_user_refresh_tokens(db, user.id)
    refresh = issue_refresh_token(db, user.id)
    access = create_access_token(str(user.id))
    set_auth_cookies(response, access, refresh)
    db.commit()

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        needs_password=False,
    )


@router.post("/register")
def register(_: RegisterRequest):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Registration is invite-only",
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Login with email + password."""
    user = get_user_by_email(db, body.email)
    if (
        not user
        or not user.password_hash
        or not verify_password(body.password, user.password_hash)
        or user.status != UserStatus.active
        or user.email_verified is not True
    ):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access = create_access_token(str(user.id))
    refresh = issue_refresh_token(db, user.id)
    set_auth_cookies(response, access, refresh)
    db.commit()
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        needs_password=False,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    body: RefreshRequest | None = Body(default=None),
    db: Session = Depends(get_db),
):
    refresh_value = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not refresh_value:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    rotated = rotate_refresh_token(db, refresh_value)
    if not rotated:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user_id, new_refresh = rotated
    user = get_user_by_id(db, user_id)
    if not user or user.status == UserStatus.deactivated:
        revoke_refresh_token(db, new_refresh)
        db.commit()
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(str(user.id))
    set_auth_cookies(response, access, new_refresh)
    db.commit()
    return TokenResponse(
        access_token=access,
        refresh_token=new_refresh,
        needs_password=user.password_hash is None,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    body: RefreshRequest | None = Body(default=None),
    db: Session = Depends(get_db),
):
    refresh_value = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if refresh_value:
        revoke_refresh_token(db, refresh_value)
        db.commit()
    clear_auth_cookies(response)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me/preferences", response_model=UserResponse)
def update_preferences(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update user preferences (theme, etc). Merges with existing preferences."""
    current_prefs = current_user.preferences or {}
    current_prefs.update(body)
    current_user.preferences = current_prefs
    # Force SQLAlchemy to detect the JSON change
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(current_user, "preferences")
    db.commit()
    db.refresh(current_user)
    return current_user
