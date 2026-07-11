import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.asset import Asset
from ..models.approval import Approval, ApprovalStatus
from ..models.activity import ActivityLog, ActivityAction, Notification, NotificationType
from ..schemas.approval import ApprovalCreate, ApprovalResponse
from ..services.approval_service import get_active_version, upsert_approval
from ..services.permissions import get_asset_access, require_asset_access
from ..services.workspace_service import get_workspace_name
from ..tasks.email_tasks import send_approval_email
from ..tasks.celery_app import send_task_safe
from ..config import settings

router = APIRouter(tags=["approvals"])
logger = logging.getLogger(__name__)


def _get_asset(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.post("/assets/{asset_id}/approve", response_model=ApprovalResponse)
def approve_asset(
    asset_id: uuid.UUID,
    body: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    if not get_asset_access(db, asset, current_user).can_approve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approval permission required")

    approval = upsert_approval(db, asset, body.version_id, current_user, ApprovalStatus.approved, body.note)

    db.add(ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.approved))
    creator = None
    if asset.created_by != current_user.id:
        db.add(Notification(user_id=asset.created_by, type=NotificationType.approval, asset_id=asset_id))
        creator = db.query(User).filter(User.id == asset.created_by, User.deleted_at.is_(None)).first()
    workspace_name = get_workspace_name(db)
    email_payload = None if creator is None else {
        "to_email": creator.email,
        "reviewer_name": current_user.name,
        "asset_name": asset.name,
        "status": "approved",
        "asset_link": f"{settings.frontend_url}/assets/{asset_id}",
        "note": body.note,
        "workspace_name": workspace_name,
    }
    db.commit()
    if email_payload is not None:
        try:
            send_task_safe(send_approval_email, **email_payload)
        except RuntimeError:
            logger.warning("Failed to start approval email dispatch")

    return approval


@router.post("/assets/{asset_id}/reject", response_model=ApprovalResponse)
def reject_asset(
    asset_id: uuid.UUID,
    body: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    if not get_asset_access(db, asset, current_user).can_approve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approval permission required")

    approval = upsert_approval(db, asset, body.version_id, current_user, ApprovalStatus.rejected, body.note)

    db.add(ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.rejected))
    creator = None
    if asset.created_by != current_user.id:
        db.add(Notification(user_id=asset.created_by, type=NotificationType.approval, asset_id=asset_id))
        creator = db.query(User).filter(User.id == asset.created_by, User.deleted_at.is_(None)).first()
    workspace_name = get_workspace_name(db)
    email_payload = None if creator is None else {
        "to_email": creator.email,
        "reviewer_name": current_user.name,
        "asset_name": asset.name,
        "status": "rejected",
        "asset_link": f"{settings.frontend_url}/assets/{asset_id}",
        "note": body.note,
        "workspace_name": workspace_name,
    }
    db.commit()
    if email_payload is not None:
        try:
            send_task_safe(send_approval_email, **email_payload)
        except RuntimeError:
            logger.warning("Failed to start approval email dispatch")

    return approval


@router.get("/assets/{asset_id}/approvals", response_model=list[ApprovalResponse])
def list_approvals(
    asset_id: uuid.UUID,
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_asset_access(db, asset, current_user)
    get_active_version(db, asset, version_id)
    return db.query(Approval).filter(
        Approval.asset_id == asset_id,
        Approval.version_id == version_id,
        Approval.deleted_at.is_(None),
    ).all()
