from unittest.mock import patch

from apps.api.services import s3_service


def test_server_side_client_is_built_once():
    s3_service.get_s3_client.cache_clear()
    try:
        with patch.object(s3_service.boto3, "client") as build:
            first = s3_service.get_s3_client()
            second = s3_service.get_s3_client()
        assert first is second
        assert build.call_count == 1
    finally:
        s3_service.get_s3_client.cache_clear()
