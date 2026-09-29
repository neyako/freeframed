"""Editors name revisions "draft 1 - X", "draft 2 - X", ... out of habit.

Versioning already tracks revisions, so the prefix is dropped and a new draft
of X stacks onto the existing X as its next version instead of becoming a
separate asset.
"""
import re
import uuid
from collections import defaultdict
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.asset import Asset, AssetType

_DRAFT_PREFIX = re.compile(r"^\s*draft\s*#?\s*(\d+)(?:\s*[-–—_:.]+\s*|\s+)", re.IGNORECASE)


def split_draft_name(name: str) -> Optional[tuple[int, str]]:
    """("draft 3 - Intro") -> (3, "Intro"); None when there's no draft prefix."""
    match = _DRAFT_PREFIX.match(name)
    if not match:
        return None
    rest = name[match.end():].strip()
    return (int(match.group(1)), rest) if rest else None


def draft_key(name: str) -> str:
    """What two names must share to be drafts of the same asset."""
    draft = split_draft_name(name)
    base = draft[1] if draft else name
    return " ".join(base.split()).casefold()


def find_draft_target(
    db: Session,
    project_id: uuid.UUID,
    folder_id: Optional[uuid.UUID],
    asset_type: AssetType,
    base_name: str,
) -> Optional[Asset]:
    """The asset a new draft of `base_name` stacks onto, if one exists here."""
    key = draft_key(base_name)
    candidates = (
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.folder_id.is_(None) if folder_id is None else Asset.folder_id == folder_id,
            Asset.asset_type == asset_type,
            Asset.deleted_at.is_(None),
            # Narrow in SQL; the exact draft-aware match happens below
            func.lower(Asset.name).endswith(base_name.strip().lower(), autoescape=True),
        )
        .order_by(Asset.created_at)
        .all()
    )
    return next((asset for asset in candidates if draft_key(asset.name) == key), None)


def plan_draft_merges(assets: list[Asset]) -> list[tuple[Asset, list[Asset], str]]:
    """Group live assets that are drafts of each other.

    Returns (target, sources, name) per group that has a draft-prefixed asset:
    sources fold into the target in draft order, and the target takes `name`.
    The earliest draft is the target, so v1 stays v1.
    """
    groups: dict[tuple, list[Asset]] = defaultdict(list)
    for asset in assets:
        groups[(asset.project_id, asset.folder_id, asset.asset_type, draft_key(asset.name))].append(asset)

    plans = []
    for group in groups.values():
        drafts = {asset.id: split_draft_name(asset.name) for asset in group}
        if not any(drafts.values()):
            continue
        group.sort(key=lambda asset: (drafts[asset.id][0] if drafts[asset.id] else 0, asset.created_at))
        target, *sources = group
        name = drafts[target.id][1] if drafts[target.id] else target.name
        plans.append((target, sources, name))
    return plans
