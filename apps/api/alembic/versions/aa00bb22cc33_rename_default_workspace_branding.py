"""rename default workspace branding to freeframed

Rebrands the out-of-the-box workspace name: rows still carrying the
upstream default 'FreeFrame' (never customized by the admin) become
'freeframed', and the column default changes to match for new installs.

Revision ID: aa00bb22cc33
Revises: ff00aa11bb22
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "aa00bb22cc33"
down_revision: Union[str, Sequence[str], None] = "ff00aa11bb22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE workspace_settings SET name = 'freeframed' WHERE name = 'FreeFrame'"
    )
    op.alter_column(
        "workspace_settings",
        "name",
        server_default="freeframed",
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.execute(
        "UPDATE workspace_settings SET name = 'FreeFrame' WHERE name = 'freeframed'"
    )
    op.alter_column(
        "workspace_settings",
        "name",
        server_default="FreeFrame",
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )
