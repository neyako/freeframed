from __future__ import annotations

import pytest

from ._folder_scope_support import build_folder_scope_world, folder_scope_client


@pytest.mark.parametrize(
    ("method", "path_kind", "body"),
    [
        ("patch", "move", {"folder_id": None}),
        (
            "post",
            "upload",
            {
                "asset_name": "blocked",
                "original_filename": "blocked.mov",
                "mime_type": "video/quicktime",
                "file_size_bytes": 10,
            },
        ),
        (
            "post",
            "version",
            {
                "asset_name": "blocked",
                "original_filename": "blocked.mov",
                "mime_type": "video/quicktime",
                "file_size_bytes": 10,
            },
        ),
        ("post", "share", {"title": "blocked"}),
        ("patch", "settings", {"name": "blocked"}),
    ],
)
def test_folder_direct_access_denies_project_mutation_surfaces(
    db,
    make_project,
    make_user,
    method,
    path_kind,
    body,
) -> None:
    world = build_folder_scope_world(db, make_project, make_user)
    paths = {
        "move": f"/assets/{world.asset_a1.id}/move",
        "upload": "/upload/initiate",
        "version": f"/assets/{world.asset_a1.id}/versions",
        "share": f"/assets/{world.asset_a1.id}/share",
        "settings": f"/projects/{world.project.id}",
    }
    request_body = dict(body)
    if path_kind == "upload":
        request_body.update(
            project_id=str(world.project.id),
            folder_id=str(world.child_a1.id),
        )
    if path_kind == "version":
        request_body.update(project_id=str(world.project.id))

    with folder_scope_client(db, world.recipient) as client:
        response = getattr(client, method)(paths[path_kind], json=request_body)

    assert response.status_code == 403, response.text
