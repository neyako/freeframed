from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import event

from apps.api.models.folder import Folder
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.models.share import SharePermission
from apps.api.services.permissions import get_asset_access

from ._folder_scope_support import build_folder_scope_world, folder_scope_client


def test_folder_direct_project_envelope_is_scoped_without_membership(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)

    with folder_scope_client(db, world.recipient) as client:
        response = client.get(f"/projects/{world.project.id}")
        projects = client.get("/projects")

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "id",
        "name",
        "asset_count",
        "storage_bytes",
        "member_count",
        "role",
        "folder_access",
    }
    assert body["asset_count"] == 5
    assert body["storage_bytes"] == 150
    assert body["member_count"] == 0
    assert body["role"] is None
    assert body["folder_access"]["kind"] == "folder_direct"
    assert set(body["folder_access"]["accessible_root_ids"]) == {str(world.root_a.id), str(world.root_b.id)}
    assert {
        (grant["folder_id"], grant["permission"])
        for grant in body["folder_access"]["grants"]
    } == {
        (str(world.root_a.id), "view"),
        (str(world.child_a1.id), "approve"),
        (str(world.root_b.id), "comment"),
    }
    assert projects.status_code == 200
    assert str(world.project.id) not in {item["id"] for item in projects.json()}
    assert db.query(ProjectMember).filter_by(
        project_id=world.project.id,
        user_id=world.recipient.id,
    ).count() == 0


def test_folder_direct_tree_and_lists_never_expose_root_or_sibling(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)

    with folder_scope_client(db, world.recipient) as client:
        tree = client.get(f"/projects/{world.project.id}/folder-tree")
        roots = client.get(f"/projects/{world.project.id}/folders", params={"parent_id": "root"})
        children = client.get(
            f"/projects/{world.project.id}/folders",
            params={"parent_id": str(world.root_a.id)},
        )
        sibling = client.get(
            f"/projects/{world.project.id}/folders",
            params={"parent_id": str(world.root_c.id)},
        )

    assert tree.status_code == 200, tree.text
    assert [(item["id"], item["parent_id"]) for item in tree.json()] == [
        (str(world.root_a.id), None),
        (str(world.root_b.id), None),
    ]
    assert {item["id"] for item in roots.json()} == {str(world.root_a.id), str(world.root_b.id)}
    assert [item["id"] for item in children.json()] == [str(world.child_a1.id)]
    assert sibling.status_code == 404


def test_folder_direct_asset_collection_is_sql_scoped_before_versions(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    expected = {world.asset_a.id, world.asset_a1.id, world.asset_a2.id, world.asset_b.id, world.asset_b1.id}

    with folder_scope_client(db, world.recipient) as client:
        all_assets = client.get(f"/projects/{world.project.id}/assets")
        descendant = client.get(
            f"/projects/{world.project.id}/assets",
            params={"folder_id": str(world.child_a1.id)},
        )
        root = client.get(f"/projects/{world.project.id}/assets", params={"folder_id": "root"})
        sibling = client.get(
            f"/projects/{world.project.id}/assets",
            params={"folder_id": str(world.root_c.id)},
        )

    assert all_assets.status_code == 200, all_assets.text
    assert {item["id"] for item in all_assets.json()} == {str(item) for item in expected}
    assert [item["id"] for item in descendant.json()] == [str(world.asset_a1.id)]
    assert root.status_code == 200 and root.json() == []
    assert sibling.status_code == 404


def test_folder_direct_effective_permissions_are_ranked_per_root(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)

    actual = {
        "a": get_asset_access(db, world.asset_a, world.recipient).direct_permission,
        "a1": get_asset_access(db, world.asset_a1, world.recipient).direct_permission,
        "a2": get_asset_access(db, world.asset_a2, world.recipient).direct_permission,
        "b": get_asset_access(db, world.asset_b, world.recipient).direct_permission,
        "c": get_asset_access(db, world.asset_c, world.recipient).direct_permission,
    }

    assert actual == {
        "a": SharePermission.view,
        "a1": SharePermission.approve,
        "a2": SharePermission.approve,
        "b": SharePermission.comment,
        "c": None,
    }


def test_folder_direct_playback_allowed_but_raw_download_and_management_denied(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    monkeypatch.setattr("apps.api.routers.assets.create_hls_token", lambda *args, **kwargs: "redacted")

    with folder_scope_client(db, world.recipient) as client:
        playback = client.get(f"/assets/{world.asset_a1.id}/stream")
        download = client.get(f"/assets/{world.asset_a1.id}/stream", params={"download": True})
        members = client.get(f"/projects/{world.project.id}/members")
        trash = client.get(f"/projects/{world.project.id}/trash")
        mutation = client.patch(f"/projects/{world.project.id}", json={"name": "leak"})

    assert playback.status_code == 200, playback.text
    assert playback.json()["url"].startswith("/stream/hls/")
    assert download.status_code == 403
    assert members.status_code == 403
    assert trash.status_code == 403
    assert mutation.status_code == 403


def test_soft_deleted_grants_revoke_every_scoped_collection_immediately(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    deleted_at = datetime.now(timezone.utc)
    for grant in world.grants:
        grant.deleted_at = deleted_at
    db.commit()

    with folder_scope_client(db, world.recipient) as client:
        responses = [
            client.get(f"/projects/{world.project.id}"),
            client.get(f"/projects/{world.project.id}/folder-tree"),
            client.get(f"/projects/{world.project.id}/folders"),
            client.get(f"/projects/{world.project.id}/assets"),
            client.get(f"/assets/{world.asset_a1.id}"),
        ]

    assert [response.status_code for response in responses] == [403, 403, 403, 403, 403]


@pytest.mark.parametrize("access_kind", ["member", "public"])
def test_member_and_public_precedence_are_not_downgraded(
    db,
    make_project,
    make_user,
    monkeypatch,
    access_kind,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    monkeypatch.setattr(
        "apps.api.routers.assets.generate_presigned_get_url",
        lambda *args, **kwargs: "redacted",
    )
    actor = world.recipient if access_kind == "member" else world.public_reader
    if access_kind == "member":
        db.add(ProjectMember(project_id=world.project.id, user_id=actor.id, role=ProjectRole.viewer))
    else:
        world.project.is_public = True
    db.commit()

    with folder_scope_client(db, actor) as client:
        project = client.get(f"/projects/{world.project.id}")
        assets = client.get(f"/projects/{world.project.id}/assets")
        download = client.get(f"/assets/{world.asset_a.id}/stream", params={"download": True})

    assert project.status_code == 200
    assert project.json()["folder_access"] is None
    assert len(assets.json()) == 7
    assert download.status_code == 200


def test_scoped_project_tree_and_assets_query_count_is_bounded_by_descendant_count(
    db,
    make_project,
    make_user,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    engine = db.get_bind()

    def request_query_count() -> int:
        statements: list[str] = []

        def capture(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture)
        try:
            with folder_scope_client(db, world.recipient) as client:
                responses = [
                    client.get(f"/projects/{world.project.id}"),
                    client.get(f"/projects/{world.project.id}/folder-tree"),
                    client.get(f"/projects/{world.project.id}/assets"),
                ]
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        assert [response.status_code for response in responses] == [200, 200, 200]
        return len(statements)

    baseline_count = request_query_count()
    db.add_all([
        Folder(
            project_id=world.project.id,
            parent_id=world.root_a.id,
            name=f"bounded-{index}",
            created_by=world.owner.id,
        )
        for index in range(25)
    ])
    db.commit()

    assert request_query_count() == baseline_count
