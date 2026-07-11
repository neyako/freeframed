from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, BrokenBarrierError
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from apps.api.models.activity import ActivityLog, Notification
from apps.api.models.approval import Approval
from apps.api.models.asset import (
    Asset,
    AssetType,
    AssetVersion,
    FileType,
    MediaFile,
    ProcessingStatus,
)
from apps.api.models.folder import Folder
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.models.share import (
    AssetShare,
    ShareActivityAction,
    ShareLink,
    ShareLinkActivity,
    SharePermission,
    ShareVisibility,
)
from apps.api.routers import approvals, share
from apps.api.schemas.approval import ApprovalCreate
from apps.api.schemas.share import DirectShareCreate, MultiShareCreate, ShareLinkCreate, ShareLinkUpdate


def _add_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID, role: ProjectRole) -> ProjectMember:
    member = ProjectMember(project_id=project_id, user_id=user_id, role=role)
    db.add(member)
    db.flush()
    return member


def _add_asset(db: Session, project_id: uuid.UUID, creator_id: uuid.UUID, folder_id: uuid.UUID | None = None) -> Asset:
    asset = Asset(
        project_id=project_id,
        folder_id=folder_id,
        name=f"asset-{uuid.uuid4().hex}",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def _add_folder(db: Session, project_id: uuid.UUID, creator_id: uuid.UUID) -> Folder:
    folder = Folder(
        project_id=project_id,
        name=f"folder-{uuid.uuid4().hex}",
        created_by=creator_id,
    )
    db.add(folder)
    db.flush()
    return folder


def _add_version(db: Session, asset: Asset, deleted: bool = False) -> AssetVersion:
    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.ready,
        created_by=asset.created_by,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db.add(version)
    db.flush()
    return version


def _add_link(
    db: Session,
    asset: Asset,
    creator_id: uuid.UUID,
    *,
    permission: SharePermission = SharePermission.view,
    visibility: ShareVisibility = ShareVisibility.public,
    allow_download: bool = False,
) -> ShareLink:
    link = ShareLink(
        asset_id=asset.id,
        token=uuid.uuid4().hex,
        created_by=creator_id,
        title="Synthetic share",
        permission=permission,
        visibility=visibility,
        allow_download=allow_download,
    )
    db.add(link)
    db.flush()
    return link


def _assert_forbidden(call) -> None:
    with pytest.raises(HTTPException) as exc_info:
        call()
    assert exc_info.value.status_code == 403



