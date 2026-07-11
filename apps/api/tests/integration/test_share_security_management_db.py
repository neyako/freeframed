from __future__ import annotations

from ._share_security_support import (
    AssetShare,
    FileType,
    MediaFile,
    ProjectRole,
    ShareActivityAction,
    ShareLink,
    ShareLinkActivity,
    SharePermission,
    _add_asset,
    _add_folder,
    _add_link,
    _add_member,
    _add_version,
    _assert_forbidden,
    datetime,
    pytest,
    share,
    timezone,
    uuid,
)

def test_management_requires_editor_and_redacts_password_and_activity_pii(db, make_project, make_user) -> None:
    project, owner = make_project()
    editor = make_user()
    reviewer = make_user()
    viewer = make_user()
    direct = make_user()
    unrelated = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    _add_member(db, project.id, editor.id, ProjectRole.editor)
    _add_member(db, project.id, reviewer.id, ProjectRole.reviewer)
    _add_member(db, project.id, viewer.id, ProjectRole.viewer)
    folder = _add_folder(db, project.id, owner.id)
    asset = _add_asset(db, project.id, owner.id)
    link = _add_link(db, asset, owner.id)
    link.password_hash = "synthetic-hash"
    link.password_encrypted = "synthetic-encrypted"
    db.add(
        AssetShare(
            asset_id=asset.id,
            shared_with_user_id=direct.id,
            permission=SharePermission.approve,
            shared_by=owner.id,
        )
    )
    activity = ShareLinkActivity(
        share_link_id=link.id,
        action=ShareActivityAction.opened,
        actor_email="synthetic@example.invalid",
        actor_name="Synthetic Actor",
    )
    db.add(activity)
    db.commit()

    for manager in (owner, editor):
        detail = share.get_share_link_details(link.token, db, manager).model_dump()
        assert "password_value" not in detail
        activity_body = [
            item.model_dump() if hasattr(item, "model_dump") else item
            for item in share.get_share_link_activity(link.token, 1, 50, db, manager)
        ]
        assert activity_body

    for blocked in (reviewer, viewer, direct, unrelated):
        _assert_forbidden(lambda blocked=blocked: share.get_share_link_details(link.token, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_share_links(asset.id, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_folder_share_links(folder.id, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_project_share_links(project.id, None, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.get_share_link_activity(link.token, 1, 50, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_asset_direct_shares(asset.id, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_folder_direct_shares(folder.id, db, blocked))

    activity_schema = share.ShareLinkActivityResponse.model_validate(activity).model_dump()
    assert "actor_email" not in activity_schema
    assert "actor_name" not in activity_schema


@pytest.mark.parametrize(
    ("role", "deleted", "expected"),
    [
        (ProjectRole.owner, False, True),
        (ProjectRole.editor, False, True),
        (ProjectRole.reviewer, False, True),
        (ProjectRole.viewer, False, True),
        (ProjectRole.viewer, True, False),
    ],
)
def test_disabled_download_effective_state_requires_active_membership(
    db,
    make_project,
    make_user,
    role,
    deleted,
    expected,
) -> None:
    project, owner = make_project()
    actor = make_user()
    member = _add_member(db, project.id, actor.id, role)
    if deleted:
        member.deleted_at = datetime.now(timezone.utc)
    link = ShareLink(
        project_id=project.id,
        token=uuid.uuid4().hex,
        created_by=owner.id,
        title="download matrix",
        allow_download=False,
    )
    db.add(link)
    db.commit()

    response = share.validate_share_link_endpoint(
        link.token,
        password=None,
        log_open=False,
        db=db,
        current_user=actor,
    )

    assert response.allow_download is expected


def test_disabled_download_does_not_trust_auth_direct_share_or_public_project(db, make_project, make_user) -> None:
    project, owner = make_project(is_public=True)
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    db.add(
        AssetShare(
            asset_id=asset.id,
            shared_with_user_id=actor.id,
            permission=SharePermission.approve,
            shared_by=owner.id,
        )
    )
    link = _add_link(db, asset, owner.id, allow_download=False)
    db.commit()

    response = share.validate_share_link_endpoint(
        link.token,
        password=None,
        log_open=False,
        db=db,
        current_user=actor,
    )

    assert response.allow_download is False


def test_disabled_download_stream_enforcement_uses_the_same_membership_rule(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    version = _add_version(db, asset)
    db.add(
        MediaFile(
            version_id=version.id,
            file_type=FileType.video,
            original_filename="synthetic.mp4",
            mime_type="video/mp4",
            file_size_bytes=1,
            s3_key_raw="synthetic/raw.mp4",
            s3_key_processed="synthetic/processed",
        )
    )
    db.add(
        AssetShare(
            asset_id=asset.id,
            shared_with_user_id=actor.id,
            permission=SharePermission.approve,
            shared_by=owner.id,
        )
    )
    link = _add_link(db, asset, owner.id, allow_download=False)
    db.commit()
    monkeypatch.setattr(share, "generate_presigned_get_url", lambda *args, **kwargs: "redacted")
    monkeypatch.setattr(share, "_log_share_activity", lambda *args, **kwargs: None)

    _assert_forbidden(
        lambda: share.get_share_stream_url(
            link.token,
            asset.id,
            share_session=None,
            version_id=None,
            download=True,
            db=db,
            current_user=actor,
        )
    )

    _add_member(db, project.id, actor.id, ProjectRole.viewer)
    db.commit()
    response = share.get_share_stream_url(
        link.token,
        asset.id,
        share_session=None,
        version_id=None,
        download=True,
        db=db,
        current_user=actor,
    )
    assert response["url"] == "redacted"



