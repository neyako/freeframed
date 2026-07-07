"""add workspace settings

Revision ID: dd44ee55ff66
Revises: cc33dd44ee55
Create Date: 2026-07-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "dd44ee55ff66"
down_revision: Union[str, Sequence[str], None] = "cc33dd44ee55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), server_default="FreeFrame", nullable=False),
        sa.Column("logo_dark", sa.Text(), nullable=True),
        sa.Column("logo_light", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("users", sa.Column("invited_by_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_users_invited_by_id_users",
        "users",
        "users",
        ["invited_by_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_invited_by_id_users", "users", type_="foreignkey")
    op.drop_column("users", "invited_by_id")
    op.drop_table("workspace_settings")
