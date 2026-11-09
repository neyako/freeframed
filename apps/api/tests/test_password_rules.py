"""Passwords are 8+ characters and at most 72 UTF-8 bytes (what bcrypt reads)."""
import pytest
from pydantic import TypeAdapter, ValidationError

from apps.api.schemas.auth import NewPassword
from apps.api.services.auth_service import hash_password, verify_password

password = TypeAdapter(NewPassword)


@pytest.mark.parametrize("value", ["", "short", "é" * 37])  # 37 characters, 74 bytes
def test_new_password_rejects_weak_or_overlong_values(value):
    with pytest.raises(ValidationError):
        password.validate_python(value)


@pytest.mark.parametrize("value", ["exactly8", "x" * 72, "é" * 36])  # 72 bytes
def test_new_password_accepts_the_allowed_range(value):
    assert password.validate_python(value) == value


def test_hash_round_trips_a_multi_byte_password():
    value = "é" * 36
    assert verify_password(value, hash_password(value))
    assert not verify_password(value + "x", hash_password("another password"))
