from pydantic import BaseModel, Field, field_validator, model_validator
import uuid
from datetime import datetime
from typing import Literal, Optional, TypeAlias
from ..models.share import SharePermission, ShareVisibility


class ShareLinkAppearance(BaseModel):
    layout: Literal["grid", "list"] = "grid"
    theme: Literal["dark", "light"] = "dark"
    accent_color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    open_in_viewer: bool = True
    sort_by: Literal["name", "created_at", "file_size"] = "created_at"
    card_size: Literal["s", "m", "l"] = "m"
    aspect_ratio: Literal["landscape", "square", "portrait"] = "landscape"
    thumbnail_scale: Literal["fit", "fill"] = "fill"
    show_card_info: bool = True


_ShareLinkStateValue: TypeAlias = (
    SharePermission
    | ShareVisibility
    | ShareLinkAppearance
    | dict[str, str | bool | None]
    | str
    | bool
)


class ShareLinkCreate(BaseModel):
    permission: SharePermission = SharePermission.view
    visibility: ShareVisibility = ShareVisibility.public
    expires_at: Optional[datetime] = None
    password: Optional[str] = None
    allow_download: bool = False
    title: Optional[str] = None
    description: Optional[str] = None
    show_versions: bool = True
    show_watermark: bool = False
    appearance: ShareLinkAppearance = ShareLinkAppearance()

    @model_validator(mode="after")
    def validate_resulting_state(self) -> "ShareLinkCreate":
        if self.show_watermark and self.allow_download:
            raise ValueError("Watermarked shares cannot allow downloads")
        if self.permission == SharePermission.approve and self.visibility != ShareVisibility.secure:
            raise ValueError("Approve permission requires secure visibility")
        return self


class MultiShareCreate(BaseModel):
    asset_ids: list[uuid.UUID] = []
    folder_ids: list[uuid.UUID] = []
    title: Optional[str] = None
    permission: SharePermission = SharePermission.view
    visibility: ShareVisibility = ShareVisibility.public
    expires_at: Optional[datetime] = None
    password: Optional[str] = None
    allow_download: bool = False
    show_versions: bool = True
    show_watermark: bool = False
    appearance: ShareLinkAppearance = ShareLinkAppearance()

    @model_validator(mode="after")
    def validate_resulting_state(self) -> "MultiShareCreate":
        if self.show_watermark and self.allow_download:
            raise ValueError("Watermarked shares cannot allow downloads")
        if self.permission == SharePermission.approve and self.visibility != ShareVisibility.secure:
            raise ValueError("Approve permission requires secure visibility")
        return self


class ReviewerShareCreate(BaseModel):
    permission: SharePermission = SharePermission.comment
    allow_download: bool = False
    expires_at: Optional[datetime] = None
    password: Optional[str] = None
    title: Optional[str] = None


class ReviewerShareResponse(BaseModel):
    token: str
    asset_id: uuid.UUID
    permission: SharePermission
    allow_download: bool
    url: str
    expires_at: Optional[datetime] = None


class ShareLinkResponse(BaseModel):
    id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    project_id: Optional[uuid.UUID] = None
    token: str
    title: str
    description: Optional[str] = None
    is_enabled: bool
    permission: SharePermission
    visibility: ShareVisibility = ShareVisibility.public
    allow_download: bool
    show_versions: bool
    show_watermark: bool
    appearance: dict
    expires_at: Optional[datetime] = None
    created_at: datetime
    has_password: bool = False
    model_config = {"from_attributes": True}


class ShareLinkValidateResponse(BaseModel):
    asset_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    project_id: Optional[uuid.UUID] = None
    folder_name: Optional[str] = None
    project_name: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    permission: SharePermission = SharePermission.view
    allow_download: bool = False
    show_versions: bool = True
    show_watermark: bool = False
    appearance: Optional[dict] = None
    visibility: ShareVisibility = ShareVisibility.public
    requires_password: bool
    requires_auth: bool = False  # True when visibility=secure and user not authenticated
    created_by_name: Optional[str] = None
    viewer_name: Optional[str] = None  # Logged-in user's name (if authenticated)
    viewer_email: Optional[str] = None  # Logged-in user's email (if authenticated)
    asset: Optional[dict] = None  # Full asset details for asset shares
    branding: Optional[dict] = None  # Project branding info
    share_session: Optional[str] = None  # Session token for password-protected links


class ShareLinkUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    permission: Optional[SharePermission] = None
    visibility: Optional[ShareVisibility] = None
    is_enabled: Optional[bool] = None
    show_versions: Optional[bool] = None
    show_watermark: Optional[bool] = None
    appearance: Optional[ShareLinkAppearance] = None
    password: Optional[str] = None
    expires_at: Optional[datetime] = None
    allow_download: Optional[bool] = None

    @field_validator(
        "permission",
        "title",
        "visibility",
        "is_enabled",
        "show_versions",
        "show_watermark",
        "appearance",
        "allow_download",
        mode="before",
    )
    @classmethod
    def reject_explicit_null(
        cls,
        value: _ShareLinkStateValue | None,
    ) -> _ShareLinkStateValue:
        if value is None:
            raise ValueError("Field cannot be null")
        return value


class ShareLinkListItem(BaseModel):
    id: uuid.UUID
    token: str
    title: str
    description: Optional[str] = None
    is_enabled: bool
    permission: SharePermission
    share_type: str
    target_name: str
    view_count: int = 0
    last_viewed_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class ShareLinkActivityResponse(BaseModel):
    id: uuid.UUID
    share_link_id: uuid.UUID
    action: str
    asset_id: Optional[uuid.UUID] = None
    asset_name: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class FolderShareAssetItem(BaseModel):
    id: uuid.UUID
    name: str
    asset_type: str
    thumbnail_url: Optional[str] = None
    file_size: Optional[int] = None
    duration_seconds: Optional[float] = None
    comment_count: int = 0
    created_by_name: Optional[str] = None
    created_at: datetime


class FolderShareSubfolder(BaseModel):
    id: uuid.UUID
    name: str
    item_count: int = 0
    thumbnail_urls: list[str] = []


class FolderShareAssetsResponse(BaseModel):
    assets: list[FolderShareAssetItem]
    subfolders: list[FolderShareSubfolder]
    total: int
    page: int
    per_page: int


class DirectShareCreate(BaseModel):
    permission: SharePermission = SharePermission.view
    user_id: Optional[uuid.UUID] = None
    team_id: Optional[uuid.UUID] = None
    email: Optional[str] = None  # Alternative to user_id — invite by email
    share_token: Optional[str] = None  # If sharing from a share link context, include token for email link


class DirectShareResponse(BaseModel):
    id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    project_id: Optional[uuid.UUID] = None
    shared_with_user_id: Optional[uuid.UUID]
    shared_with_team_id: Optional[uuid.UUID]
    permission: SharePermission
    created_at: datetime
    model_config = {"from_attributes": True}
