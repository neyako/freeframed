"""add is_quick_share to projects

Also merges the three parallel migration heads (bb22cc33dd44, a11ce9b821a0,
4094df400c86) back into a single head so `alembic upgrade head` works again.

Revision ID: cc33dd44ee55
Revises: bb22cc33dd44, a11ce9b821a0, 4094df400c86
Create Date: 2026-07-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "cc33dd44ee55"
down_revision: Union[str, Sequence[str], None] = ("bb22cc33dd44", "a11ce9b821a0", "4094df400c86")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("is_quick_share", sa.Boolean(), server_default="false", nullable=False))


def downgrade() -> None:
    op.drop_column("projects", "is_quick_share")
