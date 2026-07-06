from pathlib import Path
from urllib.parse import urlparse
from pydantic_settings import BaseSettings, SettingsConfigDict


# Find .env file - check current dir, then project root
# __file__ = apps/api/config.py, so parent.parent = project root
def _find_env_file() -> str:
    project_root = Path(__file__).parent.parent.parent  # freeframe/
    candidates = [
        Path(".env"),
        Path(".env.local"),
        project_root / ".env",
        project_root / ".env.local",
    ]
    for p in candidates:
        if p.exists():
            return str(p.resolve())
    return ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",  # Ignore extra env vars not in model
    )

    database_url: str
    redis_url: str
    app_env: str = "development"
    local_mode: bool = False
    s3_storage: str = "minio"  # "s3" for AWS S3, "minio" for local MinIO
    s3_bucket: str = "freeframe"
    s3_endpoint: str = "http://minio:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_region: str = "us-east-1"
    s3_public_endpoint: str | None = (
        None  # External URL for presigned URLs (e.g. http://localhost:9000 when S3_ENDPOINT is http://minio:9000)
    )
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    frontend_url: str = "http://localhost:3000"
    cors_origins: str | None = None
    setup_token: str | None = None
    integration_api_key: str | None = None
    transcoder_engine: str = "ffmpeg"
    transcode_hwaccel: str = "auto"
    transcode_vaapi_device: str = "/dev/dri/renderD128"

    # Worker concurrency settings
    transcoding_concurrency: int = 2  # Number of concurrent video transcoding jobs
    email_concurrency: int = 2  # Number of concurrent email sending jobs

    # Email settings - supports AWS SES or any SMTP server
    # If mail_provider is "ses", uses AWS SES with aws_mail_* credentials
    # If mail_provider is "smtp", uses standard SMTP with smtp_* settings
    mail_provider: str = "ses"  # "ses" or "smtp"
    mail_from_address: str = "noreply@example.com"
    mail_from_name: str = "FreeFrame"

    # AWS SES settings
    aws_mail_access_key_id: str | None = None
    aws_mail_secret_access_key: str | None = None
    aws_mail_region: str = "ap-south-1"

    # SMTP settings (for non-SES providers like SendGrid, Mailgun, self-hosted)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"development", "dev", "test"}

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def auth_cookie_secure(self) -> bool:
        return not (self.is_development or self.local_mode)


def _hostname(value: str) -> str:
    parsed = urlparse(value)
    return parsed.hostname or ""


def _is_local_url(value: str) -> bool:
    host = _hostname(value)
    return host in {"localhost", "127.0.0.1", "::1"}


def get_cors_origins() -> list[str]:
    if settings.cors_origins:
        return [
            origin.strip().rstrip("/")
            for origin in settings.cors_origins.split(",")
            if origin.strip()
        ]

    origins = [settings.frontend_url.rstrip("/")]
    if settings.is_development:
        origins.extend(["http://localhost:3000", "http://localhost:3001"])
    return list(dict.fromkeys(origins))


def validate_runtime_settings() -> None:
    if not settings.is_production or settings.local_mode:
        return

    errors: list[str] = []
    if _is_local_url(settings.database_url):
        errors.append("DATABASE_URL must not use localhost in production")
    if _is_local_url(settings.redis_url):
        errors.append("REDIS_URL must not use localhost in production")
    if settings.s3_endpoint and _is_local_url(settings.s3_endpoint):
        errors.append("S3_ENDPOINT must not use localhost in production")
    if settings.s3_access_key == "minioadmin" or settings.s3_secret_key == "minioadmin":
        errors.append("S3 credentials must not use minioadmin in production")
    if settings.jwt_secret.startswith("change-me") or len(settings.jwt_secret) < 32:
        errors.append("JWT_SECRET must be a strong production secret")
    if settings.frontend_url.startswith("http://localhost"):
        errors.append("FRONTEND_URL must be the public production origin")

    if errors:
        raise RuntimeError("; ".join(errors))


settings = Settings()
