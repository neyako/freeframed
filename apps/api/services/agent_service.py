"""Agent accounts: non-login users that an AI agent drives with an API token.

There is one account per preset (Claude, ChatGPT, Muse, Gemini); the preset
key lives in the account's email, so the DB unique constraint keeps it one per
preset. The token is shown once at creation; only its sha256 is stored. Tokens
carry a fixed prefix so auth can tell them from JWTs without decoding.
"""
import hashlib
import secrets
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from ..models.user import User, UserStatus

TOKEN_PREFIX = "ffd_"
_EMAIL_DOMAIN = "agents.freeframed.local"


@dataclass(frozen=True)
class AgentPreset:
    key: str
    name: str

    @property
    def email(self) -> str:
        # users.email is unique and required; agents never receive mail
        return f"{self.key}@{_EMAIL_DOMAIN}"

    @property
    def avatar_url(self) -> str:
        # Served by the web app from apps/web/public/agents/
        return f"/agents/{self.key}.svg"


PRESETS: dict[str, AgentPreset] = {
    p.key: p
    for p in (
        AgentPreset("claude", "Claude"),
        AgentPreset("chatgpt", "ChatGPT"),
        AgentPreset("muse", "Muse"),
        AgentPreset("gemini", "Gemini"),
    )
}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(agent: User) -> str:
    """Give the agent a fresh token, invalidating any previous one."""
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    agent.api_token_hash = hash_token(token)
    return token


def find_agent(db: Session, preset: AgentPreset, include_deleted: bool = False) -> Optional[User]:
    query = db.query(User).filter(User.email == preset.email, User.is_agent.is_(True))
    if not include_deleted:
        query = query.filter(User.deleted_at.is_(None))
    return query.first()


def user_for_api_token(db: Session, token: str) -> Optional[User]:
    if not token.startswith(TOKEN_PREFIX):
        return None
    user = db.query(User).filter(
        User.api_token_hash == hash_token(token),
        User.is_agent.is_(True),
        User.deleted_at.is_(None),
    ).first()
    if not user or user.status != UserStatus.active:
        return None
    return user
