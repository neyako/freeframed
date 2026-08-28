"""add avatar_s3_key to users

Uploaded avatars are stored in S3 under avatars/<user_id>/ and served as
presigned GET URLs; the s3 key lives next to the existing avatar_url column
(which keeps supporting external image URLs).

Revision ID: ff00aa11bb22
Revises: ee55ff66aa77
Create Date: 2026-08-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ff00aa11bb22"
down_revision: Union[str, Sequence[str], None] = "ee55ff66aa77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_s3_key", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_s3_key")
