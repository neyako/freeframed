from ..models.user import User
from . import s3_service


def effective_avatar_url(user: User) -> str | None:
    """Browser-ready avatar URL: presigned S3 URL for uploaded avatars,
    otherwise the user's manually-set external URL (if any)."""
    if user.avatar_s3_key:
        return s3_service.generate_presigned_get_url(user.avatar_s3_key)
    return user.avatar_url
