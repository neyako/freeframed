import hmac

from fastapi import Header, HTTPException, status

from ..config import settings


def require_integration_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = settings.integration_api_key
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Integration API not configured",
        )
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid integration API key",
        )
