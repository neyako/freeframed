from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum as PyEnum
from typing import TypeAlias

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

try:
    from ..database import Base
except ImportError:
    from database import Base


JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]


class TaskOutboxState(str, PyEnum):
    pending = "pending"
    publishing = "publishing"
    published = "published"


class TaskOutbox(Base):
    __tablename__ = "task_outbox"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_task_outbox_dedupe_key"),
        UniqueConstraint("task_id", name="uq_task_outbox_task_id"),
        CheckConstraint("attempts >= 0", name="ck_task_outbox_attempts_nonnegative"),
        CheckConstraint(
            "(state = 'publishing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) "
            "OR (state IN ('pending','published') AND lease_token IS NULL AND lease_expires_at IS NULL)",
            name="ck_task_outbox_lease_state",
        ),
        Index("ix_task_outbox_state_next_attempt_at", "state", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, default=uuid.uuid4)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict[str, JsonValue]] = mapped_column(JSONB, nullable=False)
    queue: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[TaskOutboxState] = mapped_column(Enum(TaskOutboxState), default=TaskOutboxState.pending, server_default=TaskOutboxState.pending.value, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ReviewIngestRequestState(str, PyEnum):
    reserved = "reserved"
    completed = "completed"


class ReviewIngestRequest(Base):
    __tablename__ = "review_ingest_requests"
    __table_args__ = (
        UniqueConstraint("key_hash", name="uq_review_ingest_requests_key_hash"),
        UniqueConstraint("asset_id", name="uq_review_ingest_requests_asset_id"),
        UniqueConstraint("version_id", name="uq_review_ingest_requests_version_id"),
        UniqueConstraint("share_link_id", name="uq_review_ingest_requests_share_link_id"),
        CheckConstraint(
            "key_hash ~ '^[0-9a-f]{64}$' AND content_digest ~ '^[0-9a-f]{64}$' "
            "AND request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_review_ingest_requests_hashes_sha256",
        ),
        CheckConstraint(
            "(state = 'reserved' AND completed_at IS NULL AND response_payload IS NULL) "
            "OR (state = 'completed' AND completed_at IS NOT NULL AND response_payload IS NOT NULL "
            "AND response_payload <> 'null'::jsonb)",
            name="ck_review_ingest_requests_state_payload",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    content_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    share_link_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    state: Mapped[ReviewIngestRequestState] = mapped_column(Enum(ReviewIngestRequestState), default=ReviewIngestRequestState.reserved, server_default=ReviewIngestRequestState.reserved.value, nullable=False)
    response_payload: Mapped[dict[str, JsonValue] | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
