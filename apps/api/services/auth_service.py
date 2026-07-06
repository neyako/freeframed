from datetime import datetime, timedelta, timezone
import hashlib
from typing import Optional
import uuid
from jose import JWTError, jwt
import bcrypt
from fastapi import Response
from sqlalchemy.orm import Session
from ..config import settings
from ..models.user import RefreshToken, User, UserStatus

ACCESS_COOKIE = "ff_access_token"
REFRESH_COOKIE = "ff_refresh_token"

def hash_password(password: str) -> str:
    # bcrypt has a 72 byte limit, truncate to avoid errors
    pwd_bytes = password[:72].encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_bytes = bcrypt.hashpw(pwd_bytes, salt)
    return hashed_bytes.decode('utf-8')

def verify_password(plain: str, hashed: str) -> bool:
    try:
        plain_bytes = plain[:72].encode('utf-8')
        hashed_bytes = hashed.encode('utf-8')
        return bcrypt.checkpw(plain_bytes, hashed_bytes)
    except ValueError:
        return False

def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "type": "access", "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def create_refresh_token(user_id: str, token_id: str | None = None, expires_at: datetime | None = None) -> str:
    expire = expires_at or datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    payload = {"sub": str(user_id), "type": "refresh", "exp": expire, "jti": token_id or str(uuid.uuid4())}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_refresh_token(db: Session, user_id: uuid.UUID) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    token_id = str(uuid.uuid4())
    token = create_refresh_token(str(user_id), token_id=token_id, expires_at=expires_at)
    db.add(
        RefreshToken(
            id=uuid.UUID(token_id),
            user_id=user_id,
            token_hash=_hash_token(token),
            expires_at=expires_at,
        )
    )
    db.flush()
    return token


def get_active_refresh_token(db: Session, token: str) -> RefreshToken | None:
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh":
        return None
    token_row = db.query(RefreshToken).filter(
        RefreshToken.token_hash == _hash_token(token),
        RefreshToken.revoked_at.is_(None),
    ).first()
    if not token_row or token_row.expires_at < datetime.now(timezone.utc):
        return None
    return token_row


def rotate_refresh_token(db: Session, token: str) -> tuple[uuid.UUID, str] | None:
    token_row = get_active_refresh_token(db, token)
    if not token_row:
        return None
    new_token = issue_refresh_token(db, token_row.user_id)
    new_payload = decode_token(new_token)
    if not new_payload:
        return None
    token_row.revoked_at = datetime.now(timezone.utc)
    token_row.replaced_by_id = uuid.UUID(new_payload["jti"])
    return token_row.user_id, new_token


def revoke_refresh_token(db: Session, token: str) -> None:
    token_row = get_active_refresh_token(db, token)
    if token_row:
        token_row.revoked_at = datetime.now(timezone.utc)


def revoke_user_refresh_tokens(db: Session, user_id: uuid.UUID) -> None:
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": datetime.now(timezone.utc)}, synchronize_session="fetch")


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    same_site = "lax"
    response.set_cookie(
        ACCESS_COOKIE,
        access_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=same_site,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=same_site,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/", samesite="lax")
    response.delete_cookie(REFRESH_COOKIE, path="/", samesite="lax")

def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email, User.deleted_at.is_(None)).first()

def get_user_by_id(db: Session, user_id: uuid.UUID) -> Optional[User]:
    return db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
