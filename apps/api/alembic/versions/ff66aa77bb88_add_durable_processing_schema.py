"""add durable processing schema

Revision ID: ff66aa77bb88
Revises: ee55ff66aa77
Create Date: 2026-07-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "ff66aa77bb88"
down_revision: Union[str, Sequence[str], None] = "ee55ff66aa77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


task_outbox_state = postgresql.ENUM(
    "pending",
    "publishing",
    "published",
    name="taskoutboxstate",
    create_type=False,
)
review_ingest_request_state = postgresql.ENUM(
    "reserved",
    "completed",
    name="reviewingestrequeststate",
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        "ALTER TYPE processingstatus ADD VALUE IF NOT EXISTS "
        "'queued' BEFORE 'processing'"
    )
    op.add_column(
        "media_files",
        sa.Column("upload_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "media_files",
        sa.Column("upload_aborted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "media_files",
        sa.Column("completion_fingerprint", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "media_files",
        sa.Column("raw_object_etag", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "media_files",
        sa.Column("raw_object_size", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "asset_versions",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "asset_versions",
        sa.Column("processing_finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "asset_versions",
        sa.Column("processing_error", sa.Text(), nullable=True),
    )

    op.execute("CREATE TYPE taskoutboxstate AS ENUM ('pending','publishing','published')")
    op.execute("CREATE TYPE reviewingestrequeststate AS ENUM ('reserved','completed')")
    op.create_table(
        "task_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("queue", sa.String(length=100), nullable=False),
        sa.Column("state", task_outbox_state, server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("lease_token", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("attempts >= 0", name="ck_task_outbox_attempts_nonnegative"),
        sa.CheckConstraint(
            "(state = 'publishing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) "
            "OR (state IN ('pending','published') AND lease_token IS NULL AND lease_expires_at IS NULL)",
            name="ck_task_outbox_lease_state",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key", name="uq_task_outbox_dedupe_key"),
        sa.UniqueConstraint("task_id", name="uq_task_outbox_task_id"),
    )
    op.create_index(
        "ix_task_outbox_state_next_attempt_at",
        "task_outbox",
        ["state", "next_attempt_at"],
    )
    op.create_table(
        "review_ingest_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("content_digest", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("share_link_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("s3_key", sa.String(length=1000), nullable=False),
        sa.Column("state", review_ingest_request_state, server_default="reserved", nullable=False),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "key_hash ~ '^[0-9a-f]{64}$' AND content_digest ~ '^[0-9a-f]{64}$' "
            "AND request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_review_ingest_requests_hashes_sha256",
        ),
        sa.CheckConstraint(
            "(state = 'reserved' AND completed_at IS NULL AND response_payload IS NULL) "
            "OR (state = 'completed' AND completed_at IS NOT NULL AND response_payload IS NOT NULL "
            "AND response_payload <> 'null'::jsonb)",
            name="ck_review_ingest_requests_state_payload",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key_hash", name="uq_review_ingest_requests_key_hash"),
        sa.UniqueConstraint("asset_id", name="uq_review_ingest_requests_asset_id"),
        sa.UniqueConstraint("version_id", name="uq_review_ingest_requests_version_id"),
        sa.UniqueConstraint("share_link_id", name="uq_review_ingest_requests_share_link_id"),
    )


def downgrade() -> None:
    op.drop_table("review_ingest_requests")
    op.drop_table("task_outbox")
    op.execute("DROP TYPE reviewingestrequeststate")
    op.execute("DROP TYPE taskoutboxstate")
    op.drop_column("asset_versions", "processing_error")
    op.drop_column("asset_versions", "processing_finished_at")
    op.drop_column("asset_versions", "processing_started_at")
    op.drop_column("media_files", "raw_object_size")
    op.drop_column("media_files", "raw_object_etag")
    op.drop_column("media_files", "completion_fingerprint")
    op.drop_column("media_files", "upload_aborted_at")
    op.drop_column("media_files", "upload_completed_at")
    # PostgreSQL cannot remove one enum label without rewriting every dependent
    # value. Deliberately retain `processingstatus.queued` on downgrade.
