"""The per-file upload cap is MAX_UPLOAD_BYTES; 0 means no cap."""
from apps.api.config import settings
from apps.api.schemas.upload import upload_size_error


def test_no_cap_by_default(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 0)
    assert upload_size_error(50 * 1024**3) is None


def test_rejects_a_file_over_the_cap_and_names_it(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 2 * 1024**3)
    assert "2 GB" in upload_size_error(3 * 1024**3)


def test_allows_a_file_at_the_cap(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 2 * 1024**3)
    assert upload_size_error(2 * 1024**3) is None
