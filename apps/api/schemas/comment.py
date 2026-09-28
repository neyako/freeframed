from pydantic import BaseModel, field_validator, model_validator
import uuid
from datetime import datetime
from typing import Optional

class AnnotationData(BaseModel):
    drawing_data: dict  # Fabric.js canvas JSON
    frame_number: Optional[int] = None

class CommentCreate(BaseModel):
    version_id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    timecode_start: Optional[float] = None
    timecode_end: Optional[float] = None
    body: str
    visibility: Optional[str] = "public"  # "public" or "internal"
    annotation: Optional[AnnotationData] = None
    mention_user_ids: list[uuid.UUID] = []  # Explicit mention IDs from frontend
    is_cut: bool = False

    @model_validator(mode="after")
    def cut_needs_range(self) -> "CommentCreate":
        if self.is_cut and (
            self.timecode_start is None or self.timecode_end is None or self.timecode_end <= self.timecode_start
        ):
            raise ValueError("A cut needs a range: timecode_end after timecode_start")
        return self

class GuestCommentCreate(BaseModel):
    asset_id: Optional[uuid.UUID] = None  # Required for folder shares
    version_id: Optional[uuid.UUID] = None  # Auto-resolved if not provided
    parent_id: Optional[uuid.UUID] = None
    timecode_start: Optional[float] = None
    timecode_end: Optional[float] = None
    body: str
    annotation: Optional[AnnotationData] = None
    guest_email: Optional[str] = None  # Not needed if user is logged in
    guest_name: Optional[str] = None

class CommentUpdate(BaseModel):
    body: str

class AnnotationResponse(BaseModel):
    id: uuid.UUID
    comment_id: uuid.UUID
    drawing_data: dict
    frame_number: Optional[int]
    model_config = {"from_attributes": True}

# ── Attachments ────────────────────────────────────────────────────────────────

class AttachmentUploadRequest(BaseModel):
    file_name: str
    file_size: int
    content_type: str

class AttachmentUploadResponse(BaseModel):
    upload_url: str
    attachment_id: uuid.UUID
    key: str

class AttachmentResponse(BaseModel):
    id: uuid.UUID
    file_name: str
    file_size: int
    content_type: str
    url: str  # presigned S3 GET URL, generated at response time

# ── Reactions ──────────────────────────────────────────────────────────────────

class ReactionCreate(BaseModel):
    emoji: str

    @field_validator("emoji")
    @classmethod
    def emoji_max_length(cls, v: str) -> str:
        if len(v) > 10:
            raise ValueError("emoji must be at most 10 characters")
        return v

class ReactionResponse(BaseModel):
    emoji: str
    count: int
    reacted: bool  # whether the current user has reacted with this emoji

# ── Author info ────────────────────────────────────────────────────────────────

class AuthorInfo(BaseModel):
    id: uuid.UUID
    name: str
    avatar_url: Optional[str] = None

class GuestAuthorInfo(BaseModel):
    id: uuid.UUID
    name: str

# ── Comments ───────────────────────────────────────────────────────────────────

class CommentResponse(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    version_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    author_id: Optional[uuid.UUID]
    guest_author_id: Optional[uuid.UUID]
    timecode_start: Optional[float]
    timecode_end: Optional[float]
    body: str
    resolved: bool
    visibility: str = "public"
    is_cut: bool = False
    created_at: datetime
    updated_at: datetime
    author: Optional[AuthorInfo] = None
    guest_author: Optional[GuestAuthorInfo] = None
    annotation: Optional[AnnotationResponse] = None
    replies: list["CommentResponse"] = []
    attachments: list[AttachmentResponse] = []
    reactions: list[ReactionResponse] = []
    model_config = {"from_attributes": True}

    @field_validator("is_cut", mode="before")
    @classmethod
    def _unflushed_is_not_cut(cls, v):
        # Column default only applies on INSERT; unflushed rows carry None
        return bool(v)

CommentResponse.model_rebuild()
