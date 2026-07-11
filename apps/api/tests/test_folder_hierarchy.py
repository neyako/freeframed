from collections import deque
from dataclasses import dataclass
import uuid

import pytest
from fastapi import HTTPException

from apps.api.routers import folders
from apps.api.services import permissions


@dataclass(frozen=True, slots=True)
class ParentRow:
    parent_id: uuid.UUID | None


class ScriptedQuery:
    def __init__(
        self,
        all_results: deque[list[tuple[uuid.UUID]]],
        first_results: deque[ParentRow | None],
    ) -> None:
        self.all_results = all_results
        self.first_results = first_results

    def filter(self, *conditions):
        return self

    def all(self) -> list[tuple[uuid.UUID]]:
        return self.all_results.popleft()

    def first(self) -> ParentRow | None:
        return self.first_results.popleft()


class ScriptedSession:
    def __init__(
        self,
        all_results: list[list[tuple[uuid.UUID]]] | None = None,
        first_results: list[ParentRow | None] | None = None,
    ) -> None:
        self.script = ScriptedQuery(
            deque(all_results or []),
            deque(first_results or []),
        )

    def query(self, *entities) -> ScriptedQuery:
        return self.script


def test_characterization_helpers_return_acyclic_bfs_and_depth() -> None:
    # Given
    root, child, sibling, grandchild = (uuid.uuid4() for _ in range(4))
    descendants_db = ScriptedSession(
        all_results=[[(child,), (sibling,)], [(grandchild,)], [], []],
    )
    subtree_db = ScriptedSession(
        all_results=[[(child,), (sibling,)], [(grandchild,)], [], []],
    )
    depth_db = ScriptedSession(
        first_results=[ParentRow(root), ParentRow(None)],
    )

    # When
    descendant_ids = folders._get_descendant_ids(descendants_db, root)
    subtree_depth = folders._max_subtree_depth(subtree_db, root)
    depth = folders._get_depth(depth_db, child)

    # Then
    assert descendant_ids == [child, sibling, grandchild]
    assert subtree_depth == 2
    assert depth == 2


def test_characterization_permission_grandchild_accepts_and_sibling_rejects() -> None:
    # Given
    root, child, grandchild, sibling = (uuid.uuid4() for _ in range(4))
    descendant_db = ScriptedSession(
        first_results=[ParentRow(child), ParentRow(root)],
    )
    sibling_db = ScriptedSession(first_results=[ParentRow(None)])

    # When
    descendant = permissions._is_descendant_of(descendant_db, grandchild, root)
    unrelated = permissions._is_descendant_of(sibling_db, sibling, root)

    # Then
    assert descendant is True
    assert unrelated is False


@pytest.mark.parametrize("shape", ["self", "two_node"])
@pytest.mark.parametrize(
    "helper",
    ["descendants", "depth", "including_deleted", "subtree"],
)
def test_cycle_helpers_raise_conflict_before_repeated_query(helper: str, shape: str) -> None:
    # Given
    root, child = uuid.uuid4(), uuid.uuid4()
    if shape == "self":
        all_results = [[(root,)]]
        first_results = [ParentRow(root)]
    else:
        all_results = [[(child,)], [(root,)]]
        first_results = [ParentRow(child), ParentRow(root)]
    db = ScriptedSession(all_results=all_results, first_results=first_results)

    # When
    with pytest.raises(HTTPException) as caught:
        match helper:
            case "descendants":
                folders._get_descendant_ids(db, root)
            case "depth":
                folders._get_depth(db, root)
            case "including_deleted":
                folders._get_descendant_ids_including_deleted(db, root)
            case "subtree":
                folders._max_subtree_depth(db, root)

    # Then
    assert caught.value.status_code == 409
    assert caught.value.detail == "Folder hierarchy contains a cycle"


@pytest.mark.parametrize("shape", ["self", "two_node"])
def test_permission_cycle_raises_conflict_before_repeated_query(shape: str) -> None:
    # Given
    root, child, unrelated = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    parents = [ParentRow(root)] if shape == "self" else [ParentRow(child), ParentRow(root)]
    db = ScriptedSession(first_results=parents)

    # When
    with pytest.raises(HTTPException) as caught:
        permissions._is_descendant_of(db, root, unrelated)

    # Then
    assert caught.value.status_code == 409
    assert caught.value.detail == "Folder hierarchy contains a cycle"
