from __future__ import annotations

from ._share_security_support import (
    FileType,
    MediaFile,
    ProjectRole,
    ShareLink,
    SharePermission,
    ShareLinkUpdate,
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


@pytest.mark.parametrize("scope", ["asset", "folder"])
@pytest.mark.parametrize("role", [None, ProjectRole.editor])
def test_owner_account_can_manage_shares_without_membership(db, make_project, make_user, scope, role) -> None:
    project, owner = make_project()
    admin = make_user()
    admin.is_superadmin = True
    if role is not None:
        _add_member(db, project.id, admin.id, role)
    target = _add_asset(db, project.id, owner.id) if scope == "asset" else _add_folder(db, project.id, owner.id)
    link = ShareLink(
        **{f"{scope}_id": target.id}, token=uuid.uuid4().hex,
        created_by=owner.id, permission=SharePermission.comment,
        allow_download=False, show_watermark=False,
    )
    db.add(link)
    db.commit()

    updated = share.update_share_link(link.token, ShareLinkUpdate(allow_download=True), db, admin)
    assert updated.allow_download is True
    updated = share.update_share_link(
        link.token, ShareLinkUpdate(allow_download=False, show_watermark=True), db, admin,
    )
    assert updated.show_watermark is True and updated.allow_download is False
    # Owner access must not bypass the watermark/download invariant.
    with pytest.raises(share.HTTPException) as exc_info:
        share.update_share_link(link.token, ShareLinkUpdate(allow_download=True), db, admin)
    assert exc_info.value.status_code == 422
    share.revoke_share_link(link.token, db, admin)
    assert db.get(ShareLink, link.id).deleted_at is not None
    _assert_forbidden(lambda: share.update_share_link(link.token, ShareLinkUpdate(title="gone"), db, admin))


@pytest.mark.parametrize("scope", ["asset", "folder"])
@pytest.mark.parametrize("deleted", ["target", "project"])
def test_owner_account_cannot_manage_shares_of_deleted_targets(db, make_project, make_user, scope, deleted) -> None:
    project, owner = make_project()
    admin = make_user()
    admin.is_superadmin = True
    target = _add_asset(db, project.id, owner.id) if scope == "asset" else _add_folder(db, project.id, owner.id)
    link = ShareLink(**{f"{scope}_id": target.id}, token=uuid.uuid4().hex, created_by=owner.id)
    db.add(link)
    (target if deleted == "target" else project).deleted_at = datetime.now(timezone.utc)
    db.commit()

    for token in (link.token, uuid.uuid4().hex):
        _assert_forbidden(lambda: share.update_share_link(token, ShareLinkUpdate(title="blocked"), db, admin))
        _assert_forbidden(lambda: share.revoke_share_link(token, db, admin))


def test_management_requires_membership_and_redacts_password(db, make_project, make_user) -> None:
    project, owner = make_project()
    foreign_project, foreign_owner = make_project()
    editor = make_user()
    unrelated = make_user()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    _add_member(db, project.id, editor.id, ProjectRole.editor)
    _add_member(db, foreign_project.id, foreign_owner.id, ProjectRole.owner)
    folder = _add_folder(db, project.id, owner.id)
    asset = _add_asset(db, project.id, owner.id)
    link = _add_link(db, asset, owner.id)
    link.password_hash = "synthetic-hash"
    db.commit()

    for manager in (owner, editor):
        listed = share.list_share_links(asset.id, db, manager)
        assert [item.token for item in listed] == [link.token]
        assert listed[0].has_password is True
        assert "password_hash" not in listed[0].model_dump()
        updated = share.update_share_link(link.token, ShareLinkUpdate(title="safe"), db, manager)
        assert "password_hash" not in updated.model_dump()

    for blocked in (unrelated, foreign_owner):
        _assert_forbidden(lambda blocked=blocked: share.list_share_links(asset.id, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_folder_share_links(folder.id, db, blocked))
        _assert_forbidden(lambda blocked=blocked: share.list_project_share_links(project.id, None, db, blocked))

    token_management_calls = (
        lambda token, actor: share.update_share_link(token, ShareLinkUpdate(title="safe"), db, actor),
        lambda token, actor: share.revoke_share_link(token, db, actor),
    )
    for blocked in (unrelated, foreign_owner):
        for token in (link.token, uuid.uuid4().hex):
            for call in token_management_calls:
                _assert_forbidden(lambda call=call, token=token, blocked=blocked: call(token, blocked))

@pytest.mark.parametrize(
    ("role", "deleted", "expected"),
    [
        (ProjectRole.owner, False, True),
        (ProjectRole.editor, False, True),
        (ProjectRole.editor, True, False),
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
    link = _add_link(db, _add_asset(db, project.id, owner.id), owner.id, allow_download=False)
    db.commit()

    response = share.validate_share_link_endpoint(
        link.token,
        password=None,
        db=db,
        current_user=actor,
    )

    assert response.allow_download is expected


def test_disabled_download_does_not_trust_authenticated_non_member(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)
    link = _add_link(db, asset, owner.id, allow_download=False)
    db.commit()

    response = share.validate_share_link_endpoint(
        link.token,
        password=None,
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
    link = _add_link(db, asset, owner.id, allow_download=False)
    db.commit()
    monkeypatch.setattr(share, "generate_presigned_get_url", lambda *args, **kwargs: "redacted")

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

    _add_member(db, project.id, actor.id, ProjectRole.editor)
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

