from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AgentResponse(BaseModel):
    """A preset agent; `connected_at` is null until the owner connects it."""
    preset: str
    name: str
    avatar_url: str
    connected_at: Optional[datetime] = None


class AgentTokenResponse(BaseModel):
    agent: AgentResponse
    token: str  # shown once; only its hash is stored
