from pydantic import BaseModel
import uuid
from ..config import settings
from ..models.asset import AssetType

# The web client sends the browser's File.type as it is, and browsers do not
# agree on a name for the same container: for a .wav Chrome reports audio/wav,
# Safari audio/x-wav, and a .bwf arrives as audio/vnd.wave. Every spelling a
# browser can produce for a format we accept has to be listed, or the upload is
# refused before a byte is sent. The pipeline never reads this value (ffmpeg
# probes the bytes), so an alias costs nothing.
ALLOWED_MIME_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/tiff", "image/gif",
    # Audio
    "audio/mpeg", "audio/aac", "audio/ogg",
    "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/x-pn-wav",
    "audio/aiff", "audio/x-aiff",
    "audio/flac", "audio/x-flac",
    "audio/x-m4a", "audio/mp4",
    # Video
    "video/mp4", "video/x-m4v", "video/quicktime",
    "video/x-msvideo", "video/avi",
    "video/x-matroska", "video/matroska",
    "video/webm", "video/mpeg", "video/x-ms-wmv",
}

CHUNK_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def _format_bytes(num_bytes: int) -> str:
    """Human-readable size for error messages, e.g. '10 GB'."""
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{int(value)} {unit}" if value == int(value) else f"{value:.1f} {unit}"
        value /= 1024


def upload_size_error(file_size_bytes: int) -> str | None:
    """Error detail if the file exceeds the configured per-file cap, else None.

    `settings.max_upload_bytes == 0` means no cap. Read at call time so the
    limit follows the MAX_UPLOAD_BYTES env var.
    """
    limit = settings.max_upload_bytes
    if limit and file_size_bytes > limit:
        return f"File exceeds {_format_bytes(limit)} limit"
    return None


def mime_to_asset_type(mime_type: str) -> AssetType:
    if mime_type.startswith("image/"):
        return AssetType.image
    elif mime_type.startswith("audio/"):
        return AssetType.audio
    elif mime_type.startswith("video/"):
        return AssetType.video
    raise ValueError(f"Unsupported mime type: {mime_type}")

class InitiateUploadRequest(BaseModel):
    project_id: uuid.UUID
    asset_name: str
    original_filename: str
    mime_type: str
    file_size_bytes: int
    folder_id: uuid.UUID | None = None

class InitiateUploadResponse(BaseModel):
    upload_id: str
    s3_key: str
    asset_id: uuid.UUID
    version_id: uuid.UUID

class PresignPartRequest(BaseModel):
    s3_key: str
    upload_id: str
    part_number: int  # 1-indexed

class PresignPartResponse(BaseModel):
    presigned_url: str
    part_number: int

class UploadPart(BaseModel):
    PartNumber: int
    ETag: str

class CompleteUploadRequest(BaseModel):
    s3_key: str
    upload_id: str
    asset_id: uuid.UUID
    version_id: uuid.UUID
    parts: list[UploadPart]

class CompleteUploadResponse(BaseModel):
    status: str
    asset_id: uuid.UUID
    version_id: uuid.UUID

class AbortUploadRequest(BaseModel):
    s3_key: str
    upload_id: str
    version_id: uuid.UUID
