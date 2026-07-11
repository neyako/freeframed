import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from apps.api.models.asset import Asset
from apps.api.models.folder import Folder
from apps.api.models.share import ShareLink
from apps.api.routers import folders, share
from apps.api.schemas.folder import BulkMoveRequest
from apps.api.services import permissions
from apps.api.tests.integration._folder_hierarchy_support import graph


@pytest.mark.parametrize("operation", ["bulk", "delete"])
def test_active_cycle_bulk_and_delete_return_conflict_without_sql_change(
    db,
    make_project,
    operation: str,
) -> None:
    # Given
    seeded = graph(db, make_project)
    seeded.parent.parent_id = seeded.child.id
    db.commit()
    original_parents = (seeded.parent.parent_id, seeded.child.parent_id)

    # When
    with pytest.raises(HTTPException) as caught:
        if operation == "bulk":
            folders.bulk_move(
                seeded.project.id,
                BulkMoveRequest(
                    folder_ids=[seeded.parent.id],
                    target_folder_id=seeded.sibling.id,
                ),
                db,
                seeded.owner,
            )
        else:
            folders.delete_folder(seeded.parent.id, db, seeded.owner)

    # Then
    with Session(db.get_bind()) as observer:
        parent = observer.get(Folder, seeded.parent.id)
        child = observer.get(Folder, seeded.child.id)
        assert caught.value.status_code == 409
        assert caught.value.detail == "Folder hierarchy contains a cycle"
        assert parent is not None and child is not None
        assert (parent.parent_id, child.parent_id) == original_parents
        assert parent.deleted_at is None and child.deleted_at is None


@pytest.mark.parametrize("shape", ["self", "two_node"])
def test_real_postgres_permission_cycle_with_observed_ancestor_returns_conflict(
    db,
    make_project,
    shape: str,
) -> None:
    # Given
    seeded = graph(db, make_project)
    ancestor_id = seeded.parent.id
    if shape == "self":
        seeded.parent.parent_id = seeded.parent.id
        folder_id = seeded.parent.id
    else:
        seeded.parent.parent_id = seeded.child.id
        folder_id = seeded.child.id
    db.commit()

    # When
    with pytest.raises(HTTPException) as caught:
        permissions._is_descendant_of(db, folder_id, ancestor_id)

    # Then
    assert caught.value.status_code == 409
    assert caught.value.detail == "Folder hierarchy contains a cycle"


def test_permission_route_rejects_two_node_cycle_without_state_change(db, make_project) -> None:
    # Given
    seeded = graph(db, make_project)
    seeded.parent.parent_id = seeded.child.id
    seeded.asset.folder_id = seeded.child.id
    link = ShareLink(
        folder_id=seeded.parent.id,
        token=f"cycle-{uuid.uuid4().hex}",
        title="cycle",
        created_by=seeded.owner.id,
    )
    db.add(link)
    db.commit()
    original_parents = (seeded.parent.parent_id, seeded.child.parent_id)

    # When
    with pytest.raises(HTTPException) as caught:
        share.list_share_versions(link.token, seeded.asset.id, None, db, None)

    # Then
    with Session(db.get_bind()) as observer:
        parent = observer.get(Folder, seeded.parent.id)
        child = observer.get(Folder, seeded.child.id)
        asset = observer.get(Asset, seeded.asset.id)
        assert caught.value.status_code == 409
        assert caught.value.detail == "Folder hierarchy contains a cycle"
        assert parent is not None and child is not None and asset is not None
        assert (parent.parent_id, child.parent_id) == original_parents
        assert asset.folder_id == seeded.child.id
