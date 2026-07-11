import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models.approval import Approval, ApprovalStatus
from ..models.asset import Asset, AssetVersion
from ..models.user import User


def get_active_version(db: Session, asset: Asset, version_id: uuid.UUID) -> AssetVersion:
    version = (
        db.query(AssetVersion)
        .filter(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset.id,
            AssetVersion.deleted_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset version not found",
        )
    return version


def upsert_approval(
    db: Session,
    asset: Asset,
    version_id: uuid.UUID,
    user: User,
    new_status: ApprovalStatus,
    note: str | None,
) -> Approval:
    get_active_version(db, asset, version_id)
    approval = (
        db.query(Approval)
        .filter(
            Approval.version_id == version_id,
            Approval.user_id == user.id,
        )
        .first()
    )
    if approval is None:
        approval = Approval(
            asset_id=asset.id,
            version_id=version_id,
            user_id=user.id,
            status=new_status,
            note=note,
        )
        db.add(approval)
    else:
        approval.asset_id = asset.id
        approval.status = new_status
        approval.note = note
        approval.deleted_at = None
    db.flush()
    return approval
