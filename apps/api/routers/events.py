from fastapi import APIRouter, Depends, Query, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
import uuid
from typing import Optional
from sqlalchemy.orm import Session
from ..database import SessionLocal, get_db
from ..middleware.auth import get_optional_user
from ..services.auth_service import decode_token, get_user_by_id
from ..models.user import User, UserStatus
from ..services.event_service import event_stream
from ..models.project import ProjectRole
from ..services.permissions import require_project_role

router = APIRouter(prefix="/events", tags=["events"])


def _may_still_listen(project_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Whether this account can still read the project's events right now.

    Opens its own short-lived session: the request's session sits in the
    stream's lifetime and would answer from rows it loaded when the stream opened.
    """
    db = SessionLocal()
    try:
        user = get_user_by_id(db, user_id)
        if not user or user.status == UserStatus.deactivated:
            return False
        try:
            require_project_role(db, project_id, user, ProjectRole.editor)
        except HTTPException:
            return False
        return True
    finally:
        db.close()


@router.get("/{project_id}")
async def stream_events(
    project_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    token: Optional[str] = Query(None),
    current_user: Optional[User] = Depends(get_optional_user),
):
    # EventSource can't send Authorization headers, so accept token as query param
    user = current_user
    if not user and token:
        payload = decode_token(token)
        if payload and payload.get("type") == "access":
            user = get_user_by_id(db, uuid.UUID(payload["sub"]))
    if not user or user.status == UserStatus.deactivated:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authenticated")

    require_project_role(db, project_id, user, ProjectRole.editor)
    user_id = user.id

    async def still_allowed() -> bool:
        return await run_in_threadpool(_may_still_listen, project_id, user_id)

    return StreamingResponse(
        event_stream(str(project_id), still_allowed),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
