"""agent accounts and annotation snapshots

An agent account (users.is_agent) is a non-login user that an AI agent drives
through an API token (only its sha256 is stored). Drawn comments keep a
frame snapshot (video frame + drawing) so agents can see what was circled.

Revision ID: ad45ef67a890
Revises: ac34de56f789
Create Date: 2026-11-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ad45ef67a890"
down_revision: Union[str, Sequence[str], None] = "ac34de56f789"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_agent", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("users", sa.Column("api_token_hash", sa.String(64), nullable=True))
    op.create_index("ix_users_api_token_hash", "users", ["api_token_hash"], unique=True)
    op.add_column("annotations", sa.Column("snapshot_s3_key", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("annotations", "snapshot_s3_key")
    op.drop_index("ix_users_api_token_hash", table_name="users")
    op.drop_column("users", "api_token_hash")
    op.drop_column("users", "is_agent")
