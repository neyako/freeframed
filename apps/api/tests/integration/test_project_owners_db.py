import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func
from sqlalchemy.orm import sessionmaker

from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.user import User
from apps.api.routers.projects import remove_project_member, update_project_member
from apps.api.schemas.project import UpdateProjectMemberRequest
from apps.api.tests.integration.project_test_helpers import (
    _active_owner_ids,
    _member,
    _project_with_owner,
)


def test_singleton_owner_demotion_returns_409_and_preserves_owner(db, make_user) -> None:
    # Given
    owner = make_user("single-demote@invalid.test", "Single Demote")
    project = _project_with_owner(db, owner)
    db.commit()

    # When
    with pytest.raises(HTTPException) as raised:
        update_project_member(
            project.id,
            owner.id,
            UpdateProjectMemberRequest(role=ProjectRole.editor),
            db=db,
            current_user=owner,
        )

    # Then
    assert raised.value.status_code == 409
    assert raised.value.detail == "Project must have at least one active owner"
    assert _active_owner_ids(db, project.id) == {owner.id}


def test_singleton_owner_removal_returns_409_and_preserves_membership(db, make_user) -> None:
    # Given
    owner = make_user("single-remove@invalid.test", "Single Remove")
    project = _project_with_owner(db, owner)
    db.commit()

    # When
    with pytest.raises(HTTPException) as raised:
        remove_project_member(project.id, owner.id, db=db, current_user=owner)

    # Then
    assert raised.value.status_code == 409
    assert raised.value.detail == "Project must have at least one active owner"
    assert _active_owner_ids(db, project.id) == {owner.id}


def test_soft_deleted_second_owner_does_not_satisfy_invariant(db, make_user) -> None:
    # Given
    owner = make_user("soft-owner-a@invalid.test", "Soft Owner A")
    deleted_owner = make_user("soft-owner-b@invalid.test", "Soft Owner B")
    project = _project_with_owner(db, owner)
    soft_member = _member(project, deleted_owner, ProjectRole.owner)
    soft_member.deleted_at = datetime.now(timezone.utc)
    db.add(soft_member)
    db.commit()

    # When
    with pytest.raises(HTTPException) as raised:
        update_project_member(
            project.id,
            owner.id,
            UpdateProjectMemberRequest(role=ProjectRole.reviewer),
            db=db,
            current_user=owner,
        )

    # Then
    assert raised.value.status_code == 409
    assert _active_owner_ids(db, project.id) == {owner.id}


def test_two_owner_demotion_succeeds_and_leaves_one_owner(db, make_user) -> None:
    # Given
    owner_a = make_user("demote-a@invalid.test", "Demote A")
    owner_b = make_user("demote-b@invalid.test", "Demote B")
    project = _project_with_owner(db, owner_a)
    db.add(_member(project, owner_b, ProjectRole.owner))
    db.commit()

    # When
    member = update_project_member(
        project.id,
        owner_a.id,
        UpdateProjectMemberRequest(role=ProjectRole.editor),
        db=db,
        current_user=owner_b,
    )

    # Then
    assert member.role == ProjectRole.editor
    assert _active_owner_ids(db, project.id) == {owner_b.id}


def test_two_owner_removal_succeeds_and_leaves_one_owner(db, make_user) -> None:
    # Given
    owner_a = make_user("remove-a@invalid.test", "Remove A")
    owner_b = make_user("remove-b@invalid.test", "Remove B")
    project = _project_with_owner(db, owner_a)
    db.add(_member(project, owner_b, ProjectRole.owner))
    db.commit()

    # When
    remove_project_member(project.id, owner_a.id, db=db, current_user=owner_b)

    # Then
    assert _active_owner_ids(db, project.id) == {owner_b.id}


def test_non_owner_role_change_remains_valid(db, make_user) -> None:
    # Given
    owner = make_user("change-owner@invalid.test", "Change Owner")
    editor = make_user("change-editor@invalid.test", "Change Editor")
    project = _project_with_owner(db, owner)
    db.add(_member(project, editor, ProjectRole.editor))
    db.commit()

    # When
    member = update_project_member(
        project.id,
        editor.id,
        UpdateProjectMemberRequest(role=ProjectRole.viewer),
        db=db,
        current_user=owner,
    )

    # Then
    assert member.role == ProjectRole.viewer
    assert _active_owner_ids(db, project.id) == {owner.id}


def test_non_owner_removal_remains_valid(db, make_user) -> None:
    # Given
    owner = make_user("remove-owner@invalid.test", "Remove Owner")
    reviewer = make_user("remove-reviewer@invalid.test", "Remove Reviewer")
    project = _project_with_owner(db, owner)
    reviewer_member = _member(project, reviewer, ProjectRole.reviewer)
    db.add(reviewer_member)
    db.commit()

    # When
    remove_project_member(project.id, reviewer.id, db=db, current_user=owner)

    # Then
    db.refresh(reviewer_member)
    assert reviewer_member.deleted_at is not None
    assert _active_owner_ids(db, project.id) == {owner.id}


def test_owner_to_owner_remains_valid(db, make_user) -> None:
    # Given
    owner = make_user("same-owner@invalid.test", "Same Owner")
    project = _project_with_owner(db, owner)
    db.commit()

    # When
    member = update_project_member(
        project.id,
        owner.id,
        UpdateProjectMemberRequest(role=ProjectRole.owner),
        db=db,
        current_user=owner,
    )

    # Then
    assert member.role == ProjectRole.owner
    assert _active_owner_ids(db, project.id) == {owner.id}


def test_concurrent_owner_self_removals_leave_one_owner(
    db, migrated_engine, make_user
) -> None:
    # Given
    owner_a = make_user("race-owner-a@invalid.test", "Race Owner A")
    owner_b = make_user("race-owner-b@invalid.test", "Race Owner B")
    project = _project_with_owner(db, owner_a)
    db.add(_member(project, owner_b, ProjectRole.owner))
    db.commit()
    project_id = project.id
    owner_ids = (owner_a.id, owner_b.id)
    target_barrier = threading.Barrier(2)
    count_barrier = threading.Barrier(2)
    local = threading.local()
    session_factory = sessionmaker(bind=migrated_engine)

    def gate_vulnerable_target_read(
        _conn, _cursor, statement, _parameters, _context, _executemany
    ):
        if not getattr(local, "enabled", False):
            return
        normalized = " ".join(statement.lower().split())
        if (
            normalized.startswith("select")
            and "from projects" in normalized
            and "for update" in normalized
        ):
            local.project_lock_seen = True
            return
        if (
            not getattr(local, "project_lock_seen", False)
            and normalized.startswith("select")
            and "from project_members" in normalized
        ):
            if "count(" in normalized:
                count_barrier.wait(timeout=10)
                return
            local.member_reads = getattr(local, "member_reads", 0) + 1
            if local.member_reads == 2:
                target_barrier.wait(timeout=10)

    def remove_self(owner_id: uuid.UUID) -> int:
        session = session_factory()
        local.enabled = True
        local.project_lock_seen = False
        local.member_reads = 0
        try:
            owner = session.query(User).filter(User.id == owner_id).one()
            try:
                remove_project_member(project_id, owner_id, db=session, current_user=owner)
            except HTTPException as exc:
                session.rollback()
                return exc.status_code
            return 204
        finally:
            local.enabled = False
            session.close()

    # When
    executor = ThreadPoolExecutor(max_workers=2)
    futures = []
    workers_stopped = True
    event.listen(migrated_engine, "after_cursor_execute", gate_vulnerable_target_read)
    try:
        futures = [executor.submit(remove_self, owner_id) for owner_id in owner_ids]
        statuses = sorted(future.result(timeout=20) for future in futures)
    finally:
        if futures:
            _, not_done = wait(futures, timeout=5)
            workers_stopped = not not_done
        executor.shutdown(wait=workers_stopped, cancel_futures=True)
        event.remove(migrated_engine, "after_cursor_execute", gate_vulnerable_target_read)

    # Then
    assert workers_stopped, "owner-removal workers did not stop"
    assert statuses == [204, 409]
    db.expire_all()
    assert db.query(func.count(ProjectMember.id)).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.role == ProjectRole.owner,
        ProjectMember.deleted_at.is_(None),
    ).scalar() == 1
