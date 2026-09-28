"""comment cuts and asset target duration

A comment can mark its range as a cut; the review page subtracts all cuts
from the runtime and compares the result to the asset's target duration
(e.g. 180s for YouTube Shorts).

Revision ID: ac34de56f789
Revises: ab12cd34ef56
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ac34de56f789"
down_revision: Union[str, Sequence[str], None] = "ab12cd34ef56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("comments", sa.Column("is_cut", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("assets", sa.Column("target_duration_seconds", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("assets", "target_duration_seconds")
    op.drop_column("comments", "is_cut")
