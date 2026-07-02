"""widen file_size_bytes to bigint

Revision ID: aa11bb22cc33
Revises: 8ca3dffea55f
Create Date: 2026-07-02

Uploads advertise a 10 GB limit but these columns were INTEGER (max ~2.14 GB);
larger files failed with NumericValueOutOfRange.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'aa11bb22cc33'
down_revision: Union[str, Sequence[str], None] = '8ca3dffea55f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'media_files', 'file_size_bytes',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )
    op.alter_column(
        'comment_attachments', 'file_size_bytes',
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Lossy if any row exceeds 2**31-1; acceptable for a dev rollback.
    op.alter_column(
        'comment_attachments', 'file_size_bytes',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
    op.alter_column(
        'media_files', 'file_size_bytes',
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
