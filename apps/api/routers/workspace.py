from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.branding import WorkspaceResponse
from ..services.workspace_service import get_workspace_settings

router = APIRouter(tags=["workspace"])


@router.get("/workspace", response_model=WorkspaceResponse)
def get_workspace(db: Session = Depends(get_db)):
    return get_workspace_settings(db)
