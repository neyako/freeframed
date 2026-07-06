"""HLS proxy for secure video streaming.

Rewrites m3u8 manifests so that:
- Variant playlist URLs go through this proxy (with token auth)
- Segment (.ts) URLs also go through this proxy before a short S3 redirect

This eliminates the need for a public bucket policy on processed/*.
"""

import logging
import posixpath
from datetime import datetime, timedelta, timezone
import uuid

from jose import jwt, JWTError
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_optional_user
from ..models.asset import Asset, AssetVersion, MediaFile
from ..models.user import User
from ..services.auth_service import get_user_by_id
from ..services.permissions import require_asset_access, validate_asset_in_share, validate_share_link_with_session
from ..services.s3_service import generate_presigned_get_url, get_s3_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["streaming"])


def create_hls_token(
    s3_prefix: str,
    asset_id: uuid.UUID,
    version_id: uuid.UUID,
    expires_hours: int = 24,
    user_id: uuid.UUID | None = None,
    share_token: str | None = None,
    share_session: str | None = None,
) -> str:
    """Create a short-lived JWT for HLS proxy access."""
    payload = {
        "sub": "hls",
        "pfx": s3_prefix,
        "asset_id": str(asset_id),
        "version_id": str(version_id),
        "ctx": "share" if share_token else "asset",
        "exp": datetime.now(timezone.utc) + timedelta(hours=expires_hours),
    }
    if user_id:
        payload["user_id"] = str(user_id)
    if share_token:
        payload["share_token"] = share_token
    if share_session:
        payload["share_session"] = share_session
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _verify_hls_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("sub") != "hls":
            raise HTTPException(status_code=403, detail="Invalid token type")
        for key in ("pfx", "asset_id", "version_id", "ctx"):
            if not payload.get(key):
                raise HTTPException(status_code=403, detail="Invalid HLS token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _load_hls_media(db: Session, payload: dict) -> tuple[Asset, MediaFile]:
    try:
        asset_id = uuid.UUID(payload["asset_id"])
        version_id = uuid.UUID(payload["version_id"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=403, detail="Invalid HLS token")

    asset = db.query(Asset).filter(
        Asset.id == asset_id,
        Asset.deleted_at.is_(None),
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    version = db.query(AssetVersion).filter(
        AssetVersion.id == version_id,
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    media_file = db.query(MediaFile).filter(
        MediaFile.version_id == version.id,
        MediaFile.s3_key_processed == payload["pfx"],
    ).first()
    if not media_file:
        raise HTTPException(status_code=404, detail="Media file not found")
    return asset, media_file


def _payload_user(db: Session, payload: dict, current_user: User | None) -> User | None:
    if current_user:
        return current_user
    user_id = payload.get("user_id")
    if not user_id:
        return None
    try:
        return get_user_by_id(db, uuid.UUID(user_id))
    except ValueError:
        return None


def _revalidate_hls_token(db: Session, payload: dict, current_user: User | None) -> str:
    asset, _ = _load_hls_media(db, payload)
    if payload["ctx"] == "share":
        share_token = payload.get("share_token")
        if not share_token:
            raise HTTPException(status_code=403, detail="Invalid HLS token")
        link = validate_share_link_with_session(
            db,
            share_token,
            share_session=payload.get("share_session"),
            current_user=_payload_user(db, payload, current_user),
        )
        validate_asset_in_share(db, link, asset)
        return payload["pfx"]

    user = _payload_user(db, payload, current_user)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    require_asset_access(db, asset, user)
    return payload["pfx"]


def _rewrite_manifest(content: str, s3_prefix: str, manifest_path: str, token: str) -> str:
    manifest_dir = posixpath.dirname(manifest_path)
    lines = content.split("\n")
    result = []

    for line in lines:
        stripped = line.strip()

        # Pass through comments/tags and empty lines
        if not stripped or stripped.startswith("#"):
            result.append(line)
            continue

        # Resolve segment/playlist path relative to current manifest directory
        if manifest_dir:
            relative_key = f"{manifest_dir}/{stripped}"
        else:
            relative_key = stripped

        if stripped.endswith(".m3u8"):
            # Variant playlist -> proxy URL with token
            result.append(f"{relative_key}?token={token}")
        elif stripped.endswith(".ts"):
            result.append(f"{relative_key}?token={token}")
        else:
            result.append(line)

    return "\n".join(result)


@router.get("/hls/{path:path}")
def hls_proxy(
    path: str,
    token: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
):
    """Proxy HLS manifests with URL rewriting for secure streaming."""
    payload = _verify_hls_token(token)

    if not path.endswith((".m3u8", ".ts")):
        raise HTTPException(status_code=400, detail="Only HLS manifests and segments are proxied")

    # Prevent directory traversal
    normalised = posixpath.normpath(path)
    if normalised.startswith("..") or normalised.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid path")

    s3_prefix = _revalidate_hls_token(db, payload, current_user)

    # Defense-in-depth: verify resolved key stays within the token's prefix
    s3_key = f"{s3_prefix}/{normalised}"
    if not s3_key.startswith(s3_prefix + "/"):
        raise HTTPException(status_code=400, detail="Invalid path")

    if normalised.endswith(".ts"):
        return RedirectResponse(generate_presigned_get_url(s3_key, expires_in=60), status_code=307)

    # Fetch manifest from S3
    s3 = get_s3_client()
    try:
        obj = s3.get_object(Bucket=settings.s3_bucket, Key=s3_key)
        content = obj["Body"].read().decode("utf-8")
    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail="Manifest not found")
    except Exception as e:
        logger.error("Failed to fetch HLS manifest %s: %s", s3_key, e)
        raise HTTPException(status_code=404, detail="Manifest not found")

    rewritten = _rewrite_manifest(content, s3_prefix, normalised, token)

    return Response(
        content=rewritten,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache"},
    )
