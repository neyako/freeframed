"""A cut is a comment whose range comes out of the edit; it must have a range."""
import uuid

import pytest
from pydantic import ValidationError

from apps.api.schemas.comment import CommentCreate


def test_cut_with_range_is_valid():
    cut = CommentCreate(version_id=uuid.uuid4(), body="", timecode_start=12, timecode_end=19, is_cut=True)
    assert cut.is_cut


@pytest.mark.parametrize(("start", "end"), [(12, None), (None, None), (19, 12), (12, 12)])
def test_cut_without_a_forward_range_is_rejected(start, end):
    with pytest.raises(ValidationError):
        CommentCreate(version_id=uuid.uuid4(), body="", timecode_start=start, timecode_end=end, is_cut=True)
