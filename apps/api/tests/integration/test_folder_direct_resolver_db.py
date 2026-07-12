from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.folder import Folder
from apps.api.models.share import AssetShare, SharePermission
from apps.api.services.folder_access import resolve_folder_access

from ._folder_scope_support import build_folder_scope_world, folder_scope_client


def test_resolver_rejects_grants_for_soft_deleted_project(db, make_project, make_user) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    world.project.deleted_at = datetime.now(timezone.utc)
    db.commit()

    assert resolve_folder_access(db, world.project.id, world.recipient.id) is None


def test_accessible_roots_are_stably_deduplicated_without_dropping_grants(
    db,
    make_project,
    make_user,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    duplicate = AssetShare(
        folder_id=world.root_a.id,
        shared_with_user_id=world.recipient.id,
        permission=SharePermission.comment,
        shared_by=world.owner.id,
    )
    db.add(duplicate)
    db.commit()

    access = resolve_folder_access(db, world.project.id, world.recipient.id)

    assert access is not None
    assert set(access.accessible_root_ids) == {world.root_a.id, world.root_b.id}
    assert len(access.accessible_root_ids) == 2
    assert resolve_folder_access(
        db,
        world.project.id,
        world.recipient.id,
    ).accessible_root_ids == access.accessible_root_ids
    assert len(access.grants) == 4
    assert [grant.folder_id for grant in access.grants].count(world.root_a.id) == 2


def test_folder_direct_project_envelope_has_exact_minimal_contract(
    db,
    make_project,
    make_user,
    monkeypatch,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    world.project.description = "private description"
    world.project.poster_s3_key = "private/poster.jpg"
    monkeypatch.setattr(
        "apps.api.routers.projects.generate_presigned_get_url",
        lambda _key: (_ for _ in ()).throw(AssertionError("poster must not be presigned")),
    )

    with folder_scope_client(db, world.recipient) as client:
        response = client.get(f"/projects/{world.project.id}")

    assert response.status_code == 200, response.text
    assert set(response.json()) == {
        "id",
        "name",
        "asset_count",
        "storage_bytes",
        "member_count",
        "role",
        "folder_access",
    }
    assert response.json()["asset_count"] == 5
    assert response.json()["storage_bytes"] == 150
    assert response.json()["member_count"] == 0
    assert response.json()["role"] is None


@pytest.mark.parametrize("cycle_shape", ["self", "two_node"])
def test_folder_direct_collections_reject_corrupt_cycles(
    db,
    make_project,
    make_user,
    cycle_shape,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    world.root_a.parent_id = (
        world.root_a.id if cycle_shape == "self" else world.child_a1.id
    )
    db.commit()

    with pytest.raises(HTTPException) as caught:
        resolve_folder_access(db, world.project.id, world.recipient.id)

    assert caught.value.status_code == 409
    assert caught.value.detail == "Folder hierarchy contains a cycle"

    with folder_scope_client(db, world.recipient) as client:
        responses = [
            client.get(f"/projects/{world.project.id}"),
            client.get(f"/projects/{world.project.id}/folder-tree"),
            client.get(f"/projects/{world.project.id}/assets"),
        ]

    assert [response.status_code for response in responses] == [409, 409, 409]
    assert {response.json()["detail"] for response in responses} == {
        "Folder hierarchy contains a cycle"
    }


def test_folder_direct_collections_reject_hierarchy_over_max_depth(
    db,
    make_project,
    make_user,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    parent_id = world.grandchild_a2.id
    for depth in range(4, 12):
        folder = Folder(
            project_id=world.project.id,
            parent_id=parent_id,
            name=f"depth-{depth}",
            created_by=world.owner.id,
        )
        db.add(folder)
        db.flush()
        parent_id = folder.id
    db.commit()

    with pytest.raises(HTTPException) as caught:
        resolve_folder_access(db, world.project.id, world.recipient.id)

    assert caught.value.status_code == 409
    assert caught.value.detail == "Folder hierarchy exceeds maximum depth of 10"

    with folder_scope_client(db, world.recipient) as client:
        responses = [
            client.get(f"/projects/{world.project.id}"),
            client.get(f"/projects/{world.project.id}/folder-tree"),
            client.get(f"/projects/{world.project.id}/assets"),
        ]

    assert [response.status_code for response in responses] == [409, 409, 409]
    assert {response.json()["detail"] for response in responses} == {
        "Folder hierarchy exceeds maximum depth of 10"
    }


def test_project_openapi_declares_full_or_folder_direct_response(
    db,
    make_project,
    make_user,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)

    with folder_scope_client(db, world.recipient) as client:
        schema = client.get("/openapi.json").json()

    response_schema = schema["paths"]["/projects/{project_id}"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    refs = {item["$ref"] for item in response_schema["anyOf"]}
    assert refs == {
        "#/components/schemas/ProjectResponse",
        "#/components/schemas/FolderDirectProjectResponse",
    }
