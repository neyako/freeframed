"""Admin endpoints for user management."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import uuid

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User, UserStatus
from ..schemas.branding import WorkspaceResponse, WorkspaceUpdate
from ..schemas.auth import AdminUserResponse, UserResponse, UpdateUserRoleRequest
from ..services.auth_service import revoke_user_refresh_tokens
from ..services.email_service import email_service
from ..services.workspace_service import get_workspace_name, get_workspace_settings

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserResponse])
def list_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all users in the system. Only accessible by admins."""
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )

    users = db.query(User).filter(User.deleted_at.is_(None)).all()
    return users

@router.post("/test-email")
def test_email(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )

    try:
        ok = email_service.send_email(
            current_user.email,
            f"{get_workspace_name(db)} test email",
            "<p>SMTP/SES configuration works.</p>",
            "SMTP/SES configuration works.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"sent": ok, "provider": settings.mail_provider, "to": current_user.email}


@router.put("/workspace", response_model=WorkspaceResponse)
def update_workspace(
    body: WorkspaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )

    workspace = get_workspace_settings(db)
    if "name" in body.model_fields_set and body.name is not None:
        workspace.name = body.name
    if "logo_dark" in body.model_fields_set:
        workspace.logo_dark = body.logo_dark
    if "logo_light" in body.model_fields_set:
        workspace.logo_light = body.logo_light
    db.commit()
    db.refresh(workspace)
    return workspace

@router.patch("/users/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deactivate a user. Admins cannot deactivate themselves."""
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can deactivate users"
        )

    # Prevent admin from deactivating themselves
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate yourself"
        )

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.status = UserStatus.deactivated
    revoke_user_refresh_tokens(db, user.id)
    db.commit()
    db.refresh(user)
    return user

@router.patch("/users/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reactivate a deactivated user. Only accessible by admins."""
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can reactivate users"
        )

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.status = UserStatus.active
    db.commit()
    db.refresh(user)
    return user

@router.patch("/users/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: uuid.UUID,
    body: UpdateUserRoleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Promote or demote a user to/from admin role. Only accessible by admins."""
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can change user roles"
        )

    # Prevent admin from removing their own admin role
    if user_id == current_user.id and not body.is_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own admin role"
        )

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_superadmin = body.is_admin
    db.commit()
    db.refresh(user)
    return user
