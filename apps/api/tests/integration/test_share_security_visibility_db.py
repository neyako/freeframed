from __future__ import annotations

from ._share_security_support import (
    HTTPException,
    MultiShareCreate,
    ProjectRole,
    ShareLink,
    ShareLinkCreate,
    ShareLinkUpdate,
    SharePermission,
    ShareVisibility,
    ValidationError,
    _add_asset,
    _add_folder,
    _add_link,
    _add_member,
    pytest,
    share,
)

@pytest.mark.parametrize("schema", [ShareLinkCreate, MultiShareCreate])
@pytest.mark.parametrize(
    "payload",
    [
        {"permission": SharePermission.approve, "visibility": ShareVisibility.public},
        {"show_watermark": True, "allow_download": True},
    ],
)
def test_create_schemas_reject_forbidden_states_before_db_access(schema, payload) -> None:
    with pytest.raises(ValidationError):
        schema(**payload)


@pytest.mark.parametrize(
    "field",
    [
        "permission",
        "title",
        "visibility",
        "is_enabled",
        "show_versions",
        "show_watermark",
        "appearance",
        "allow_download",
    ],
)
def test_patch_schema_rejects_explicit_null_for_non_nullable_state(field) -> None:
    with pytest.raises(ValidationError):
        ShareLinkUpdate(**{field: None})


def test_visibility_is_typed_and_secure_persists_for_every_constructor(db, make_project) -> None:
    project, owner = make_project()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    folder = _add_folder(db, project.id, owner.id)
    asset = _add_asset(db, project.id, owner.id, folder.id)
    secure = ShareLinkCreate(visibility=ShareVisibility.secure)

    links = [
        share.create_share_link(asset.id, secure, db, owner),
        share.create_folder_share_link(folder.id, secure, db, owner),
        share.create_project_share_link(project.id, secure, db, owner),
        share.create_multi_share_link(
            project.id,
            MultiShareCreate(asset_ids=[asset.id], visibility=ShareVisibility.secure),
            db,
            owner,
        ),
    ]

    assert ShareLinkCreate.model_fields["visibility"].annotation is ShareVisibility
    assert MultiShareCreate.model_fields["visibility"].annotation is ShareVisibility
    assert [link.visibility for link in links] == [ShareVisibility.secure] * 4


def test_password_state_is_accurate_on_create_and_list_responses(db, make_project) -> None:
    project, owner = make_project()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    folder = _add_folder(db, project.id, owner.id)
    asset = _add_asset(db, project.id, owner.id)
    protected = ShareLinkCreate(password="synthetic-passphrase")

    asset_created = share.create_share_link(asset.id, protected, db, owner)
    folder_created = share.create_folder_share_link(folder.id, protected, db, owner)
    asset_listed = share.list_share_links(asset.id, db, owner)
    folder_listed = share.list_folder_share_links(folder.id, db, owner)

    assert asset_created.has_password is True
    assert folder_created.has_password is True
    assert asset_listed[0].has_password is True
    assert folder_listed[0].has_password is True


def test_partial_patch_validates_result_and_atomic_repair_succeeds(db, make_project) -> None:
    project, owner = make_project()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    link = _add_link(db, asset, owner.id)

    with pytest.raises(HTTPException) as permission_error:
        share.update_share_link(
            link.token,
            ShareLinkUpdate(permission=SharePermission.approve),
            db,
            owner,
        )
    assert permission_error.value.status_code == 422

    link.show_watermark = True
    link.allow_download = True
    db.commit()
    repaired = share.update_share_link(
        link.token,
        ShareLinkUpdate(show_watermark=False),
        db,
        owner,
    )
    assert repaired.show_watermark is False
    assert repaired.allow_download is True


def test_partial_patch_rejects_every_invalid_transition_and_repairs_legacy_rows(db, make_project) -> None:
    project, owner = make_project()
    _add_member(db, project.id, owner.id, ProjectRole.owner)
    asset = _add_asset(db, project.id, owner.id)
    link = _add_link(db, asset, owner.id)
    db.commit()

    for updates in (
        ShareLinkUpdate(permission=SharePermission.approve),
        ShareLinkUpdate(show_watermark=True),
    ):
        if updates.show_watermark:
            link.allow_download = True
            db.commit()
        with pytest.raises(HTTPException) as exc_info:
            share.update_share_link(link.token, updates, db, owner)
        assert exc_info.value.status_code == 422
        db.rollback()
        link = db.query(ShareLink).filter_by(id=link.id).one()

    link.permission = SharePermission.approve
    link.visibility = ShareVisibility.secure
    db.commit()
    with pytest.raises(HTTPException) as visibility_error:
        share.update_share_link(
            link.token,
            ShareLinkUpdate(visibility=ShareVisibility.public),
            db,
            owner,
        )
    assert visibility_error.value.status_code == 422
    db.rollback()

    link = db.query(ShareLink).filter_by(id=link.id).one()
    link.visibility = ShareVisibility.public
    db.commit()
    repaired = share.update_share_link(
        link.token,
        ShareLinkUpdate(visibility=ShareVisibility.secure),
        db,
        owner,
    )
    assert repaired.permission == SharePermission.approve
    assert repaired.visibility == ShareVisibility.secure



