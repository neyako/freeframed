from pydantic import AfterValidator, BaseModel, EmailStr, Field, model_validator
from typing import Annotated, Any
import uuid
from ..models.user import UserStatus
from ..services.auth_service import BCRYPT_MAX_PASSWORD_BYTES
from ..services.avatar_service import effective_avatar_url


def _reject_bcrypt_overflow(v: str) -> str:
    """Refuse a password bcrypt would silently truncate. The limit is 72 bytes,
    but Field(max_length=...) counts characters, so a short multi-byte password
    can still overflow and then verifies against any password sharing its first
    72 bytes."""
    if len(v.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(f"password must be at most {BCRYPT_MAX_PASSWORD_BYTES} bytes when UTF-8 encoded")
    return v


# Anything that sets a password: 8 characters minimum (an empty or one-letter
# password was accepted before) and a byte ceiling so it is never stored truncated.
NewPassword = Annotated[str, Field(min_length=8), AfterValidator(_reject_bcrypt_overflow)]

def _trimmed_nonblank(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


# A person's display name: bounded to what the column holds, then trimmed, and a
# blank one refused (min_length alone lets "   " through and stores it as "").
DisplayName = Annotated[str, Field(max_length=255), AfterValidator(_trimmed_nonblank)]


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    # No length floor on login: accounts that predate the 8-character rule must
    # still get a 401, not a 422. The cap only keeps an oversized body away from bcrypt.
    password: str = Field(max_length=4096)

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    avatar_url: str | None
    status: UserStatus
    email_verified: bool = False
    is_superadmin: bool = False
    preferences: dict = {}

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _resolve_s3_avatar(cls, data: Any) -> Any:
        """Swap a stored avatar s3 key for a browser-ready presigned URL."""
        key = getattr(data, "avatar_s3_key", None)
        if isinstance(key, str) and key:
            return {
                **{field: getattr(data, field) for field in cls.model_fields},
                "avatar_url": effective_avatar_url(data),
            }
        return data

class AdminUserResponse(UserResponse):
    invite_token: str | None = None

class InviteRequest(BaseModel):
    email: EmailStr
    name: str

# Invite flow
class AcceptInviteRequest(BaseModel):
    token: str
    # The name typed on the accept screen. The field was undeclared, so it was
    # silently dropped and the invitee kept whatever the invite dialog guessed.
    name: DisplayName
    password: NewPassword

class InviteInfoResponse(BaseModel):
    email: str
    name: str
    org_name: str
    inviter_name: str | None = None

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    password: NewPassword

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: NewPassword

class UpdateProfileRequest(BaseModel):
    name: DisplayName | None = None
    avatar_url: str | None = None
