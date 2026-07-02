import sqlalchemy as sa

from apps.api.models.asset import MediaFile
from apps.api.models.comment import CommentAttachment
from apps.api.schemas.upload import MAX_FILE_SIZE_BYTES


def test_media_file_size_column_is_bigint():
    # Given/When: the mapped media file size column metadata is inspected.
    col = MediaFile.__table__.c.file_size_bytes

    # Then: uploads above int32 range can be represented by the DB type.
    assert isinstance(col.type, sa.BigInteger)


def test_comment_attachment_size_column_is_bigint():
    # Given/When: the mapped comment attachment size column metadata is inspected.
    col = CommentAttachment.__table__.c.file_size_bytes

    # Then: attachments above int32 range can be represented by the DB type.
    assert isinstance(col.type, sa.BigInteger)


def test_declared_limit_exceeds_int32():
    # Given/When/Then: the advertised upload limit documents why BIGINT is required.
    assert MAX_FILE_SIZE_BYTES > 2**31 - 1
