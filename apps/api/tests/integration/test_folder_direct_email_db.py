from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.share import AssetShare, ShareLink, SharePermission, ShareVisibility
from apps.api.routers import share
from apps.api.schemas.share import DirectShareCreate

from ._folder_scope_support import build_folder_scope_world


def _link(world, token: str, **overrides) -> ShareLink:
    values = {
        "folder_id": world.root_a.id,
        "token": token,
        "created_by": world.owner.id,
        "title": "Synthetic secure link",
        "is_enabled": True,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "permission": SharePermission.view,
        "visibility": ShareVisibility.secure,
    }
    values.update(overrides)
    return ShareLink(**values)


def test_valid_secure_exact_folder_token_sends_validated_url(db, make_project, make_user, monkeypatch) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    link = _link(world, "synthetic-valid-token")
    db.add(link)
    db.query(AssetShare).delete()
    db.commit()
    emails: list[dict[str, str]] = []
    monkeypatch.setattr(share, "send_task_safe", lambda _task, **kwargs: emails.append(kwargs))

    created = share.share_folder_with_user(
        world.root_a.id,
        DirectShareCreate(
            user_id=world.recipient.id,
            permission=SharePermission.comment,
            share_token=link.token,
        ),
        db,
        world.owner,
    )

    assert created.permission == SharePermission.comment
    assert len(emails) == 1
    assert emails[0]["asset_link"].endswith(f"/share/{link.token}")


def test_existing_grant_upsert_emails_exact_folder_url_without_token(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    existing = world.grants[0]
    emails: list[dict[str, str]] = []
    monkeypatch.setattr(share, "send_task_safe", lambda _task, **kwargs: emails.append(kwargs))

    updated = share.share_folder_with_user(
        world.root_a.id,
        DirectShareCreate(
            user_id=world.recipient.id,
            permission=SharePermission.comment,
        ),
        db,
        world.owner,
    )

    assert updated.id == existing.id
    assert updated.permission == SharePermission.comment
    assert db.query(AssetShare).filter_by(
        folder_id=world.root_a.id,
        shared_with_user_id=world.recipient.id,
    ).count() == 1
    assert emails[0]["asset_link"] == (
        f"{share.settings.frontend_url}/projects/{world.project.id}?folder={world.root_a.id}"
    )


@pytest.mark.parametrize(
    ("kind", "overrides"),
    [
        ("public", {"visibility": ShareVisibility.public}),
        ("disabled", {"is_enabled": False}),
        ("deleted", {"deleted_at": datetime.now(timezone.utc)}),
        ("expired", {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}),
        ("sibling", {"folder_id": None}),
        ("asset", {"folder_id": None, "asset_id": "asset"}),
        ("project", {"folder_id": None, "project_id": "project"}),
    ],
)
def test_invalid_token_rejects_before_existing_grant_or_email_side_effect(
    db,
    make_project,
    make_user,
    monkeypatch,
    kind,
    overrides,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    existing = world.grants[0]
    existing.permission = SharePermission.approve
    if kind == "sibling":
        overrides = {"folder_id": world.root_b.id}
    elif kind == "asset":
        overrides = {"folder_id": None, "asset_id": world.asset_a.id}
    elif kind == "project":
        overrides = {"folder_id": None, "project_id": world.project.id}
    link = _link(world, f"synthetic-{kind}-token", **overrides)
    db.add(link)
    db.commit()
    emails: list[dict[str, str]] = []
    monkeypatch.setattr(share, "send_task_safe", lambda _task, **kwargs: emails.append(kwargs))

    with pytest.raises(HTTPException):
        share.share_folder_with_user(
            world.root_a.id,
            DirectShareCreate(
                user_id=world.recipient.id,
                permission=SharePermission.view,
                share_token=link.token,
            ),
            db,
            world.owner,
        )

    db.refresh(existing)
    assert existing.permission == SharePermission.approve
    assert emails == []
