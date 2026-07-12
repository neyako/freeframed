from typing import Literal

from pydantic import BaseModel, ConfigDict
import uuid
from datetime import datetime
from ..models.project import ProjectType, ProjectRole
from ..models.share import SharePermission

class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    project_type: ProjectType = ProjectType.personal

class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_public: bool | None = None


class FolderAccessGrantResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    folder_id: uuid.UUID
    permission: SharePermission


class FolderAccessResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["folder_direct"] = "folder_direct"
    accessible_root_ids: list[uuid.UUID]
    grants: list[FolderAccessGrantResponse]


class FolderDirectProjectResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    name: str
    asset_count: int
    storage_bytes: int
    member_count: Literal[0] = 0
    role: Literal[None] = None
    folder_access: FolderAccessResponse

class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    project_type: ProjectType
    created_by: uuid.UUID
    created_at: datetime
    poster_url: str | None = None
    is_public: bool = False
    is_quick_share: bool = False
    asset_count: int = 0
    storage_bytes: int = 0
    member_count: int = 0
    role: ProjectRole | None = None
    folder_access: FolderAccessResponse | None = None
    model_config = {"from_attributes": True}


ProjectAccessResponse = ProjectResponse | FolderDirectProjectResponse

class ProjectMemberResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    role: ProjectRole
    model_config = {"from_attributes": True}

class AddProjectMemberRequest(BaseModel):
    user_id: uuid.UUID
    role: ProjectRole = ProjectRole.viewer

class UpdateProjectMemberRequest(BaseModel):
    role: ProjectRole
