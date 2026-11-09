"""Agent accounts (workspace owner only), one per preset. An agent uploads
cuts, replies to feedback and waits for approval through the ffd CLI.

The CLI and its guide are served here too (no auth: they're the open-source
files), so an agent can install ffd straight from the freeframed it talks to.
"""
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserStatus
from ..schemas.agent import AgentResponse, AgentTokenResponse
from ..services.agent_service import PRESETS, AgentPreset, find_agent, issue_token
from .users import require_admin

router = APIRouter(tags=["agents"])

# apps/cli, copied into the API image next to apps/api
_CLI_DIR = Path(__file__).resolve().parents[2] / "cli"


def _preset(key: str) -> AgentPreset:
    preset = PRESETS.get(key)
    if not preset:
        raise HTTPException(status_code=404, detail="Unknown agent")
    return preset


def _response(preset: AgentPreset, agent: User | None) -> AgentResponse:
    return AgentResponse(
        preset=preset.key,
        name=preset.name,
        avatar_url=preset.avatar_url,
        connected_at=agent.created_at if agent else None,
    )


@router.get("/agents", response_model=list[AgentResponse])
def list_agents(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [_response(p, find_agent(db, p)) for p in PRESETS.values()]


@router.post("/agents/{preset}", response_model=AgentTokenResponse, status_code=status.HTTP_201_CREATED)
def connect_agent(preset: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    p = _preset(preset)
    agent = find_agent(db, p, include_deleted=True)
    if agent and agent.deleted_at is None:
        raise HTTPException(status_code=409, detail=f"{p.name} is already connected; issue a new token instead")
    now = datetime.now(timezone.utc)
    if agent:
        # Removed before: bring the same account back so its old comments stay its own
        agent.deleted_at = None
        agent.created_at = now
    else:
        agent = User(email=p.email, is_agent=True, email_verified=True, created_at=now)
        db.add(agent)
    agent.name = p.name
    agent.avatar_url = p.avatar_url
    agent.status = UserStatus.active
    agent.invited_by_id = admin.id
    token = issue_token(agent)
    db.commit()
    return AgentTokenResponse(agent=_response(p, agent), token=token)


@router.post("/agents/{preset}/token", response_model=AgentTokenResponse)
def rotate_agent_token(preset: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Issue a new token; the old one stops working immediately."""
    p = _preset(preset)
    agent = find_agent(db, p)
    if not agent:
        raise HTTPException(status_code=404, detail=f"{p.name} isn't connected")
    token = issue_token(agent)
    db.commit()
    return AgentTokenResponse(agent=_response(p, agent), token=token)


@router.delete("/agents/{preset}", status_code=status.HTTP_204_NO_CONTENT)
def remove_agent(preset: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Revoke the agent. Its uploads and comments stay, under its name."""
    agent = find_agent(db, _preset(preset))
    if agent:
        agent.api_token_hash = None
        agent.deleted_at = datetime.now(timezone.utc)
        db.commit()


@router.get("/cli/ffd", include_in_schema=False)
def download_ffd():
    return FileResponse(_CLI_DIR / "ffd.py", media_type="text/x-python", filename="ffd")


@router.get("/cli/guide", include_in_schema=False)
def ffd_guide():
    """The review-loop skill, printed by `ffd guide`."""
    return FileResponse(_CLI_DIR / "skills" / "freeframed-review" / "SKILL.md", media_type="text/markdown")
