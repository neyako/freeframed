from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier, Event, local
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from apps.api.models.folder import Folder
from apps.api.models.project import Project
from apps.api.routers import folders
from apps.api.schemas.folder import BulkMoveRequest, FolderUpdate
from apps.api.tests.integration._folder_hierarchy_support import graph, hierarchy_truth


@pytest.mark.parametrize("cross_path", [False, True])
def test_opposite_moves_observe_project_lock_and_leave_valid_sql_graph(
    cross_path: bool,
    db,
    make_project,
    monkeypatch,
) -> None:
    # Given
    seeded = graph(db, make_project)
    db.commit()
    barrier = Barrier(2)
    thread_state = local()
    observed_locks: list[bool] = []
    original = folders._get_descendant_ids

    def note_lock(conn, cursor, statement, parameters, context, executemany) -> None:
        if "FOR UPDATE" in statement.upper() and "FROM projects" in statement:
            thread_state.project_locked = True

    def align_unlocked(session: Session, folder_id: uuid.UUID) -> list[uuid.UUID]:
        result = original(session, folder_id)
        if not getattr(thread_state, "project_locked", False):
            barrier.wait(timeout=10)
        return result

    event.listen(db.get_bind(), "before_cursor_execute", note_lock)
    monkeypatch.setattr(folders, "_get_descendant_ids", align_unlocked)
    factory = sessionmaker(bind=db.get_bind())

    def move(source: uuid.UUID, target: uuid.UUID, use_patch: bool) -> int:
        thread_state.project_locked = False
        with factory() as session:
            try:
                if use_patch:
                    folders.update_folder(source, FolderUpdate(parent_id=target), session, seeded.owner)
                else:
                    folders.bulk_move(
                        seeded.project.id,
                        BulkMoveRequest(folder_ids=[source], target_folder_id=target),
                        session,
                        seeded.owner,
                    )
            except HTTPException as error:
                observed_locks.append(thread_state.project_locked)
                return error.status_code
        observed_locks.append(thread_state.project_locked)
        return 200

    # When
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(move, seeded.parent.id, seeded.sibling.id, cross_path)
        second = executor.submit(move, seeded.sibling.id, seeded.parent.id, False)
        statuses = sorted([first.result(timeout=20), second.result(timeout=20)])
    event.remove(db.get_bind(), "before_cursor_execute", note_lock)

    # Then
    with factory() as observer:
        acyclic, maximum_depth = hierarchy_truth(observer, seeded.project.id)
    assert statuses == [200, 400]
    assert observed_locks == [True, True]
    assert acyclic and maximum_depth <= 10


def _stale_source_events(engine, thread_state, source_loaded: Event, lock_attempted: Event):
    def before(conn, cursor, statement, parameters, context, executemany) -> None:
        if getattr(thread_state, "worker", False) and "FOR UPDATE" in statement.upper() and "FROM projects" in statement:
            lock_attempted.set()

    def after(conn, cursor, statement, parameters, context, executemany) -> None:
        if getattr(thread_state, "worker", False) and "FROM folders" in statement and "folders.id =" in statement:
            source_loaded.set()

    event.listen(engine, "before_cursor_execute", before)
    event.listen(engine, "after_cursor_execute", after)
    return before, after


def test_delete_winner_makes_waiting_patch_observe_deleted_source(db, make_project) -> None:
    # Given
    seeded = graph(db, make_project)
    db.commit()
    engine = db.get_bind()
    factory = sessionmaker(bind=engine)
    source_loaded, lock_attempted = Event(), Event()
    thread_state = local()
    before, after = _stale_source_events(engine, thread_state, source_loaded, lock_attempted)
    original_parent = seeded.child.parent_id

    def patch_waiter() -> int:
        thread_state.worker = True
        with factory() as session:
            try:
                folders.update_folder(
                    seeded.child.id,
                    FolderUpdate(parent_id=seeded.sibling.id),
                    session,
                    seeded.owner,
                )
            except HTTPException as error:
                return error.status_code
        return 200

    # When
    with factory() as winner:
        winner.query(Project).filter(Project.id == seeded.project.id).with_for_update().first()
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(patch_waiter)
            assert source_loaded.wait(10) and lock_attempted.wait(10) and not future.done()
            folders.delete_folder(seeded.child.id, winner, seeded.owner)
            waiter_status = future.result(timeout=20)
    event.remove(engine, "before_cursor_execute", before)
    event.remove(engine, "after_cursor_execute", after)

    # Then
    with factory() as observer:
        stored = observer.get(Folder, seeded.child.id)
        assert waiter_status == 404
        assert stored is not None and stored.deleted_at is not None
        assert stored.parent_id == original_parent


def test_restore_winner_makes_waiting_restore_observe_active_source(db, make_project) -> None:
    # Given
    seeded = graph(db, make_project)
    seeded.child.deleted_at = datetime.now(timezone.utc)
    db.commit()
    engine = db.get_bind()
    factory = sessionmaker(bind=engine)
    source_loaded, lock_attempted = Event(), Event()
    thread_state = local()
    before, after = _stale_source_events(engine, thread_state, source_loaded, lock_attempted)
    original_parent = seeded.child.parent_id

    def restore_waiter() -> int:
        thread_state.worker = True
        with factory() as session:
            try:
                folders.restore_folder(seeded.child.id, session, seeded.owner)
            except HTTPException as error:
                return error.status_code
        return 200

    # When
    with factory() as winner:
        winner.query(Project).filter(Project.id == seeded.project.id).with_for_update().first()
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(restore_waiter)
            assert source_loaded.wait(10) and lock_attempted.wait(10) and not future.done()
            folders.restore_folder(seeded.child.id, winner, seeded.owner)
            waiter_status = future.result(timeout=20)
    event.remove(engine, "before_cursor_execute", before)
    event.remove(engine, "after_cursor_execute", after)

    # Then
    with factory() as observer:
        stored = observer.get(Folder, seeded.child.id)
        assert waiter_status == 404
        assert stored is not None and stored.deleted_at is None
        assert stored.parent_id == original_parent
