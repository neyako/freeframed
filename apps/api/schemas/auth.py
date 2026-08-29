from pydantic import BaseModel, EmailStr, model_validator
from typing import Any
import uuid
from ..models.user import UserStatus
from ..services.avatar_service import effective_avatar_url

class RegisterRequest(BaseModel):
    email: EmailStr
    name: str
    password: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

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
    password: str

class InviteInfoResponse(BaseModel):
    email: str
    name: str
    org_name: str
    inviter_name: str | None = None

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

class UpdateProfileRequest(BaseModel):
    name: str | None = None
    avatar_url: str | None = None

class UpdateUserRoleRequest(BaseModel):
    is_admin: bool

class DeactivateUserRequest(BaseModel):
    user_id: uuid.UUID
