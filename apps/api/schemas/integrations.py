from datetime import datetime
import uuid

from pydantic import BaseModel


class ReviewIngestResponse(BaseModel):
    asset_id: uuid.UUID
    version_id: uuid.UUID
    version_number: int
    token: str
    url: str
    expires_at: datetime | None = None
